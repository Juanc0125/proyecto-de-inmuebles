#!/usr/bin/env bash
# One-time (and re-runnable) Google Cloud setup for the Stickman render job.
#
# Run it in Google Cloud Shell (https://shell.cloud.google.com), from a clone of
# the repo or after uploading this file:
#
#   bash gcp-setup.sh [PROJECT_ID]
#
# It is idempotent: every step checks what already exists and only creates or
# fixes what is missing, so running it twice is safe. It creates:
#
#   - the APIs it needs (Cloud Run, Artifact Registry, IAM credentials,
#     Secret Manager, Billing Budgets)
#   - Artifact Registry repo `stickman` (us-central1) with a cleanup policy that
#     keeps only the 2 newest images (free tier is 0.5 GB of storage)
#   - runtime SA   stickman-render-runtime  -> what the job runs as; reads only
#                                              its own secrets
#   - dispatcher SA stickman-dispatcher     -> what Vercel uses; may only run
#                                              this one job (custom role)
#   - deploy SA    stickman-deployer        -> what GitHub Actions uses through
#                                              Workload Identity Federation
#   - WIF pool `github` + provider `github-oidc`, restricted to
#     Juanc0125/stickman-video-app on refs/heads/master
#   - Secret Manager secrets for the API keys (read with `read -s`, never shown,
#     never passed as command-line arguments)
#   - the Cloud Run job `stickman-render` with a public placeholder image, so
#     the GitHub workflow only has to swap the image
#   - a billing budget alert (default 1 USD). A budget ALERTS, it does not cap.
#
# Nothing secret is echoed. Values go to gcloud through stdin.

set -euo pipefail

# ---------------------------------------------------------------- settings ---
REGION="us-central1"
JOB="stickman-render"
AR_REPO="stickman"
IMAGE_NAME="render-worker"
PLACEHOLDER_IMAGE="us-docker.pkg.dev/cloudrun/container/job:latest"
GH_REPO="Juanc0125/stickman-video-app"
GH_REF="refs/heads/master"
POOL="github"
PROVIDER="github-oidc"
RUNTIME_SA_NAME="stickman-render-runtime"
DISPATCHER_SA_NAME="stickman-dispatcher"
DEPLOY_SA_NAME="stickman-deployer"
DISPATCHER_ROLE_ID="stickmanRenderDispatcher"
BUDGET_NAME="stickman-render-budget"
KEY_FILE="${HOME}/stickman-dispatcher-key.json"
VERCEL_PROJECT="project-bftvz"
VERCEL_SCOPE="juanc0125s-projects"

# Secret Manager free tier: 6 active secret versions per billing account.
# This script keeps exactly one enabled version per secret (older ones are
# destroyed when a value is replaced), and there are at most 4 secrets.
SECRET_ENV_VARS=(SUPABASE_SERVICE_ROLE_KEY HEYGEN_API_KEY ELEVENLABS_API_KEY FAL_KEY)
# Plain env vars on the job: identifiers and URLs, not credentials.
PLAIN_ENV_VARS=(SUPABASE_URL ELEVENLABS_VOICE_ID HEYGEN_AVATAR_ID HEYGEN_VOICE_ID SENTRY_DSN)

# ----------------------------------------------------------------- helpers ---
say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m  %s\n' "$*"; }
warn() { printf '    \033[33m!!\033[0m  %s\n' "$*"; }
die()  { printf '\n\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# yes/no prompt; $2 is the default (s/n)
ask_yn() {
  local prompt="$1" def="${2:-n}" ans
  read -r -p "    $prompt [$( [ "$def" = s ] && echo 'S/n' || echo 's/N' )] " ans || true
  ans="${ans:-$def}"
  [[ "$ans" =~ ^[sSyY] ]]
}

# Adds a secret version from stdin-provided value, then destroys every older
# version so only one active version remains (free tier counts versions).
put_secret() {
  local name="$1" value="$2" latest
  if gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --project "$PROJECT_ID" --data-file=- --quiet >/dev/null
  else
    printf '%s' "$value" | gcloud secrets create "$name" --project "$PROJECT_ID" \
      --replication-policy=automatic --data-file=- --quiet >/dev/null
  fi
  latest="$(gcloud secrets versions list "$name" --project "$PROJECT_ID" \
    --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name.basename())')"
  for v in $(gcloud secrets versions list "$name" --project "$PROJECT_ID" \
      --filter='state!=DESTROYED' --format='value(name.basename())'); do
    [ "$v" = "$latest" ] && continue
    gcloud secrets versions destroy "$v" --secret "$name" --project "$PROJECT_ID" --quiet >/dev/null
  done
}

secret_exists() { gcloud secrets describe "$1" --project "$PROJECT_ID" >/dev/null 2>&1; }

ensure_sa() {
  local name="$1" display="$2" email="$1@${PROJECT_ID}.iam.gserviceaccount.com"
  if gcloud iam service-accounts describe "$email" --project "$PROJECT_ID" >/dev/null 2>&1; then
    ok "service account $email"
  else
    gcloud iam service-accounts create "$name" --project "$PROJECT_ID" --display-name "$display" --quiet >/dev/null
    ok "created service account $email"
  fi
}

# ----------------------------------------------------------------- project ---
command -v gcloud >/dev/null || die "gcloud not found. Run this in Google Cloud Shell."

PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJECT_ID" ] || die "No project. Run: bash gcp-setup.sh <PROJECT_ID>  (or gcloud config set project <PROJECT_ID>)"
gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')" \
  || die "Cannot read project $PROJECT_ID. Does it exist and do you own it?"

RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DISPATCHER_SA="${DISPATCHER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${IMAGE_NAME}"

say "Project $PROJECT_ID (#$PROJECT_NUMBER), region $REGION"

BILLING_ACCOUNT="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' 2>/dev/null || true)"
BILLING_ACCOUNT="${BILLING_ACCOUNT#billingAccounts/}"
if [ -z "$BILLING_ACCOUNT" ]; then
  die "Billing is not enabled on $PROJECT_ID. Cloud Run's free tier still needs a billing account linked: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
fi
ok "billing account linked"

# --------------------------------------------------------------------- APIs ---
say "Enabling APIs (takes a minute the first time)"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  sts.googleapis.com \
  secretmanager.googleapis.com \
  billingbudgets.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project "$PROJECT_ID" --quiet
ok "APIs enabled"

# -------------------------------------------------------- Artifact Registry ---
say "Artifact Registry repo $AR_REPO"
if gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  ok "repo exists"
else
  gcloud artifacts repositories create "$AR_REPO" --location "$REGION" --project "$PROJECT_ID" \
    --repository-format=docker --description="Stickman render worker images" --quiet >/dev/null
  ok "repo created"
fi
POLICY_FILE="$(mktemp)"
cat >"$POLICY_FILE" <<'JSON'
[
  {"name": "keep-newest-2", "action": {"type": "Keep"},
   "mostRecentVersions": {"keepCount": 2}},
  {"name": "delete-older", "action": {"type": "Delete"},
   "condition": {"tagState": "ANY", "olderThan": "1d"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies "$AR_REPO" --location "$REGION" --project "$PROJECT_ID" \
  --policy="$POLICY_FILE" --no-dry-run --quiet >/dev/null
rm -f "$POLICY_FILE"
ok "cleanup policy: keep the 2 newest images, delete the rest after 1 day"

# ---------------------------------------------------------- service accounts ---
say "Service accounts"
ensure_sa "$RUNTIME_SA_NAME"    "Stickman render job runtime"
ensure_sa "$DISPATCHER_SA_NAME" "Stickman dispatcher (Vercel starts render executions)"
ensure_sa "$DEPLOY_SA_NAME"     "Stickman deployer (GitHub Actions via WIF)"
# A freshly created SA can take a few seconds to be visible to IAM.
sleep 5

# ------------------------------------------------------------------- secrets ---
say "Secrets (Secret Manager). Values are typed hidden and never shown."
echo "    Empty answer = keep the current value (or skip if it never existed)."
declare -A SECRET_SET=()
for name in "${SECRET_ENV_VARS[@]}"; do
  exists=false; secret_exists "$name" && exists=true
  if [ "$name" = "FAL_KEY" ]; then
    echo
    warn "FAL_KEY turns on AI video: every render costs dollars (fal charges per second of video),"
    warn "and it needs the client's written OK on RF-004. Leave it empty unless that was decided."
  fi
  if [ "$name" = "SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "    (the sb_secret_... key of project mlwpsqzhefrezezrkmpu; required)"
  fi
  prompt="    $name"; $exists && prompt="$prompt (exists; Enter keeps it)"
  read -r -s -p "$prompt: " value || true
  echo
  if [ -n "${value:-}" ]; then
    put_secret "$name" "$value"
    ok "$name stored (1 active version)"
  elif $exists; then
    ok "$name kept"
  else
    if [ "$name" = "SUPABASE_SERVICE_ROLE_KEY" ]; then
      die "SUPABASE_SERVICE_ROLE_KEY is required: without it the job cannot write the video row nor upload the MP4."
    fi
    ok "$name skipped"
  fi
  unset value
  if secret_exists "$name"; then
    SECRET_SET[$name]=1
    gcloud secrets add-iam-policy-binding "$name" --project "$PROJECT_ID" \
      --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor \
      --condition=None --quiet >/dev/null
  fi
done

# ---------------------------------------------------------- plain env values ---
say "Plain settings for the job (not credentials). Empty = keep current / skip."
JOB_EXISTS=false
gcloud run jobs describe "$JOB" --region "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1 && JOB_EXISTS=true
ENV_PAIRS=()
for name in "${PLAIN_ENV_VARS[@]}"; do
  case "$name" in
    SUPABASE_URL) hint="https://mlwpsqzhefrezezrkmpu.supabase.co" ;;
    SENTRY_DSN)   hint="optional; Sentry is off without it" ;;
    *)            hint="optional" ;;
  esac
  read -r -p "    $name ($hint): " value || true
  if [ -n "${value:-}" ]; then
    case "$value" in *@@*) die "$name cannot contain '@@'." ;; esac
    ENV_PAIRS+=("$name=$value")
  elif [ "$name" = "SUPABASE_URL" ] && ! $JOB_EXISTS; then
    die "SUPABASE_URL is required on the first run."
  fi
  unset value
done
ENV_PAIRS+=("NODE_ENV=production")

# --------------------------------------------------------------- the job ---
say "Cloud Run job $JOB"
SECRET_FLAGS=""
for name in "${!SECRET_SET[@]}"; do
  SECRET_FLAGS="${SECRET_FLAGS:+$SECRET_FLAGS,}${name}=${name}:latest"
done
# "^@@^" switches gcloud's list delimiter to @@, so a value with a comma is safe.
ENV_FLAG="^@@^"
for pair in "${ENV_PAIRS[@]}"; do
  [ "$ENV_FLAG" = "^@@^" ] || ENV_FLAG="${ENV_FLAG}@@"
  ENV_FLAG="${ENV_FLAG}${pair}"
done
unset ENV_PAIRS

COMMON_FLAGS=(
  --region "$REGION" --project "$PROJECT_ID"
  --service-account "$RUNTIME_SA"
  --cpu 2 --memory 4Gi --task-timeout 1800s --max-retries 0 --tasks 1
  --quiet
)

if $JOB_EXISTS; then
  # No --image: the image belongs to the GitHub workflow. --update-* merges,
  # so a variable left empty above keeps its current value.
  UPDATE_FLAGS=(--update-env-vars "$ENV_FLAG")
  [ -n "$SECRET_FLAGS" ] && UPDATE_FLAGS+=(--update-secrets "$SECRET_FLAGS")
  gcloud run jobs update "$JOB" "${COMMON_FLAGS[@]}" "${UPDATE_FLAGS[@]}" >/dev/null
  ok "job updated (image untouched)"
else
  CREATE_FLAGS=(--set-env-vars "$ENV_FLAG")
  [ -n "$SECRET_FLAGS" ] && CREATE_FLAGS+=(--set-secrets "$SECRET_FLAGS")
  gcloud run jobs create "$JOB" --image "$PLACEHOLDER_IMAGE" "${COMMON_FLAGS[@]}" "${CREATE_FLAGS[@]}" >/dev/null
  ok "job created with placeholder image; the GitHub workflow puts the real one"
fi
unset ENV_FLAG

# ------------------------------------------- dispatcher (Vercel) least privilege ---
say "Dispatcher permissions: may only run $JOB (with env overrides)"
DISPATCHER_PERMS="run.jobs.run,run.jobs.runWithOverrides,run.executions.get"
if gcloud iam roles describe "$DISPATCHER_ROLE_ID" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam roles update "$DISPATCHER_ROLE_ID" --project "$PROJECT_ID" \
    --permissions "$DISPATCHER_PERMS" --quiet >/dev/null
else
  gcloud iam roles create "$DISPATCHER_ROLE_ID" --project "$PROJECT_ID" \
    --title "Stickman render dispatcher" \
    --description "Start executions of the render job with overrides, read their status" \
    --permissions "$DISPATCHER_PERMS" --stage GA --quiet >/dev/null
fi
# Bound on the job, not on the project: the key in Vercel cannot touch anything else.
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" --project "$PROJECT_ID" \
  --member "serviceAccount:$DISPATCHER_SA" \
  --role "projects/${PROJECT_ID}/roles/${DISPATCHER_ROLE_ID}" --quiet >/dev/null
ok "custom role $DISPATCHER_ROLE_ID bound on job $JOB only"

# ---------------------------------------------------- deployer (GitHub Actions) ---
say "Deployer permissions"
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" --project "$PROJECT_ID" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/artifactregistry.writer --quiet >/dev/null
ok "artifactregistry.writer on repo $AR_REPO"
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" --project "$PROJECT_ID" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/run.developer --quiet >/dev/null
ok "run.developer on job $JOB"
# Updating a job requires acting as the SA it runs as.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project "$PROJECT_ID" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/iam.serviceAccountUser --quiet >/dev/null
ok "serviceAccountUser on $RUNTIME_SA_NAME"
# gcloud checks that the Run API is enabled before deploying.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/serviceusage.serviceUsageConsumer \
  --condition=None --quiet >/dev/null
ok "serviceUsageConsumer on project"

# ------------------------------------------------ Workload Identity Federation ---
say "Workload Identity Federation for $GH_REPO ($GH_REF)"
POOL_STATE="$(gcloud iam workload-identity-pools describe "$POOL" --location global --project "$PROJECT_ID" \
  --format='value(state)' 2>/dev/null || true)"
if [ "$POOL_STATE" = "DELETED" ]; then
  gcloud iam workload-identity-pools undelete "$POOL" --location global --project "$PROJECT_ID" --quiet >/dev/null
  ok "pool $POOL restored"
elif [ -z "$POOL_STATE" ]; then
  gcloud iam workload-identity-pools create "$POOL" --location global --project "$PROJECT_ID" \
    --display-name "GitHub Actions" --quiet >/dev/null
  ok "pool $POOL created"
else
  ok "pool $POOL exists"
fi

CONDITION="assertion.repository=='${GH_REPO}' && assertion.ref=='${GH_REF}'"
MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.actor=assertion.actor"
PROVIDER_STATE="$(gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool "$POOL" \
  --location global --project "$PROJECT_ID" --format='value(state)' 2>/dev/null || true)"
if [ "$PROVIDER_STATE" = "DELETED" ]; then
  gcloud iam workload-identity-pools providers undelete "$PROVIDER" --workload-identity-pool "$POOL" \
    --location global --project "$PROJECT_ID" --quiet >/dev/null
  PROVIDER_STATE="ACTIVE"
fi
if [ -z "$PROVIDER_STATE" ]; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool "$POOL" \
    --location global --project "$PROJECT_ID" \
    --display-name "GitHub OIDC" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "$MAPPING" \
    --attribute-condition "$CONDITION" --quiet >/dev/null
  ok "provider $PROVIDER created"
else
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --workload-identity-pool "$POOL" \
    --location global --project "$PROJECT_ID" \
    --attribute-mapping "$MAPPING" \
    --attribute-condition "$CONDITION" --quiet >/dev/null
  ok "provider $PROVIDER up to date"
fi
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GH_REPO}" \
  --quiet >/dev/null
ok "only $GH_REPO on $GH_REF can act as $DEPLOY_SA_NAME"

# ------------------------------------------------------------ budget alert ---
say "Budget alert"
EXISTING_BUDGET="$(gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" \
  --filter="displayName=$BUDGET_NAME" --format='value(name)' 2>/dev/null || true)"
if [ -n "$EXISTING_BUDGET" ]; then
  ok "budget $BUDGET_NAME exists"
else
  read -r -p "    Budget amount with currency of your billing account [1USD]: " BUDGET_AMOUNT || true
  BUDGET_AMOUNT="${BUDGET_AMOUNT:-1USD}"
  if gcloud billing budgets create --billing-account "$BILLING_ACCOUNT" \
      --display-name "$BUDGET_NAME" \
      --budget-amount "$BUDGET_AMOUNT" \
      --filter-projects "projects/${PROJECT_ID}" \
      --threshold-rule=percent=0.5 \
      --threshold-rule=percent=0.9 \
      --threshold-rule=percent=1.0 \
      --quiet >/dev/null 2>&1; then
    ok "budget $BUDGET_NAME ($BUDGET_AMOUNT): emails billing admins at 50/90/100 %"
  else
    warn "Could not create the budget (wrong currency for the billing account, or no billing admin rights)."
    warn "Create it by hand: https://console.cloud.google.com/billing/$BILLING_ACCOUNT/budgets"
  fi
fi
warn "A budget only sends email. It does not stop spending."

# ----------------------------------------------------- dispatcher key (Vercel) ---
say "Key for Vercel (dispatcher SA)"
USER_KEYS="$(gcloud iam service-accounts keys list --iam-account "$DISPATCHER_SA" --project "$PROJECT_ID" \
  --managed-by=user --format='value(name.basename())' 2>/dev/null || true)"
MAKE_KEY=true
if [ -n "$USER_KEYS" ]; then
  warn "The dispatcher already has $(printf '%s\n' "$USER_KEYS" | wc -l) user key(s)."
  ask_yn "Create a new one (rotation)? Delete the old one afterwards with: gcloud iam service-accounts keys delete <ID> --iam-account $DISPATCHER_SA" n || MAKE_KEY=false
fi
if $MAKE_KEY; then
  ( umask 077; gcloud iam service-accounts keys create "$KEY_FILE" --iam-account "$DISPATCHER_SA" \
      --project "$PROJECT_ID" --quiet >/dev/null 2>&1 ) \
    || die "Key creation failed. If an org policy blocks SA keys (iam.disableServiceAccountKeyCreation), it must be relaxed for this project."
  ok "key written to $KEY_FILE (mode 600). Not printed."
fi

# --------------------------------------------------------------- next steps ---
cat <<EOF

=====================================================================
 Done. Next steps (copy them in order)
=====================================================================

1) GitHub repository variables (not secrets: none of these is a credential).
   From any machine with gh logged in:

gh variable set GCP_PROJECT_ID   --repo $GH_REPO --body "$PROJECT_ID"
gh variable set GCP_WIF_PROVIDER --repo $GH_REPO --body "$WIF_PROVIDER"
gh variable set GCP_DEPLOY_SA    --repo $GH_REPO --body "$DEPLOY_SA"

2) First image: GitHub > Actions > "Deploy render worker" > Run workflow
   (or: gh workflow run deploy-render-worker.yml --repo $GH_REPO --ref master)
   Until it finishes, the job runs Google's placeholder image.

3) Vercel production env. Here in Cloud Shell, in a scratch folder (not the repo):

mkdir -p ~/vercel-link && cd ~/vercel-link
npx vercel@latest login
npx vercel@latest link --yes --project $VERCEL_PROJECT --scope $VERCEL_SCOPE
printf '%s' cloud-run-job  | npx vercel@latest env add RENDER_BACKEND production
printf '%s' $PROJECT_ID    | npx vercel@latest env add GCP_PROJECT_ID production
printf '%s' $REGION        | npx vercel@latest env add GCP_REGION production
printf '%s' $JOB           | npx vercel@latest env add CLOUD_RUN_JOB production
base64 -w0 $KEY_FILE | npx vercel@latest env add GCP_SA_KEY_B64 production

   Then redeploy production so the new env is picked up:
npx vercel@latest redeploy https://project-bftvz.vercel.app --scope $VERCEL_SCOPE

4) DELETE THE LOCAL KEY FILE (it now lives only in Vercel):

shred -u $KEY_FILE

5) Check: gcloud run jobs executions list --job $JOB --region $REGION --limit 5
   after generating a video from the studio.

Re-run this script any time to change a secret or a setting; the image is
never touched by it.
EOF
