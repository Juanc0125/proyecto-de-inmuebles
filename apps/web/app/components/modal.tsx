'use client';

import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    labelledBy: string;
    children: ReactNode;
    className?: string;
    // 'drawer' slides in from the left edge (the phone navigation) instead
    // of sitting centred near the top.
    variant?: 'center' | 'drawer';
}

// Native <dialog> opened with showModal(): the browser makes the rest of the
// page inert (a real focus trap, also for screen readers), returns focus to
// whatever opened it on close, and turns Esc into a `cancel` event. We only
// keep React's `open` and the element's state in step.
export default function Modal({ open, onClose, labelledBy, children, className = '', variant = 'center' }: ModalProps) {
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            ref={ref}
            className="modal"
            aria-labelledby={labelledBy}
            onClose={onClose}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            // A click on the backdrop lands on the <dialog> itself (the card
            // stops at its own edge), which is the conventional "click away".
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            {open && <div className={`${variant === 'drawer' ? 'drawer-card' : 'modal-card'} ${className}`}>{children}</div>}
        </dialog>
    );
}
