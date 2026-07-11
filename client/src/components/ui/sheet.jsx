import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  'fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
        bottom: 'inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        left: 'inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
        right: 'inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
      },
    },
    defaultVariants: { side: 'right' },
  }
);

/**
 * Guard against the Radix "Select inside Dialog" bug: a Select/Popover menu,
 * CKEditor balloon or the draft right-click menu renders in a body portal, so
 * Radix treats clicks on/dismissing it as "outside" the sheet and closes the
 * sheet along with the dropdown.
 *
 * The dropdown dismisses itself and unmounts synchronously BEFORE the sheet's
 * outside-interaction handler runs, so checking the DOM inside that handler is
 * too late. Instead, capture-phase listeners (which fire before any Radix
 * layer sees the event) record whether a floating layer was open when the
 * pointerdown/Escape happened; the sheet's handlers consult that flag.
 */
const FLOATING_LAYER_SELECTOR =
  '[data-radix-popper-content-wrapper], [data-radix-select-viewport], .ck-body-wrapper, .draft-ctx-menu';

let floatingLayerWasOpenAt = 0;
const floatingLayerIsOpen = () => !!document.querySelector(FLOATING_LAYER_SELECTOR);
const markIfFloatingLayerOpen = () => {
  if (floatingLayerIsOpen()) floatingLayerWasOpenAt = Date.now();
};
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', markIfFloatingLayerOpen, true);
  document.addEventListener(
    'keydown',
    (e) => { if (e.key === 'Escape') markIfFloatingLayerOpen(); },
    true
  );
}

const isFloatingLayerInteraction = (event) => {
  const target = event.target;
  if (target?.closest?.(FLOATING_LAYER_SELECTOR)) return true;
  // A dropdown was open when this interaction started (it may already have
  // unmounted by now) — the interaction was meant for it, not the sheet.
  return floatingLayerIsOpen() || Date.now() - floatingLayerWasOpenAt < 500;
};

const SheetContent = React.forwardRef(({ side = 'right', className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
      onPointerDownOutside={(e) => {
        if (isFloatingLayerInteraction(e)) e.preventDefault();
        props.onPointerDownOutside?.(e);
      }}
      onInteractOutside={(e) => {
        if (isFloatingLayerInteraction(e)) e.preventDefault();
        props.onInteractOutside?.(e);
      }}
      onEscapeKeyDown={(e) => {
        // Escape with an open dropdown should close only the dropdown.
        if (floatingLayerIsOpen() || Date.now() - floatingLayerWasOpenAt < 500) e.preventDefault();
        props.onEscapeKeyDown?.(e);
      }}
    >
      <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
      {children}
    </SheetPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
);
SheetHeader.displayName = 'SheetHeader';

const SheetFooter = ({ className, ...props }) => (
  <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
);
SheetFooter.displayName = 'SheetFooter';

const SheetTitle = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-foreground', className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
