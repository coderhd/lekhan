
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface ConfirmDialogProps {
  layerClassName?: string
  returnFocus?: React.RefObject<HTMLButtonElement | null>
  fallbackFocus?: React.RefObject<HTMLElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  onConfirm: () => void
  confirmText?: string
  cancelText?: string
}

export function ConfirmDialog({
  open,
  layerClassName,
  returnFocus,
  fallbackFocus,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmText = "Continue",
  cancelText = "Cancel",
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent layerClassName={layerClassName} onCloseAutoFocus={event => {
        if (!returnFocus && !fallbackFocus) return
        event.preventDefault()
        const trigger = returnFocus?.current
        if (trigger?.isConnected && !trigger.matches(':disabled')) {
          trigger.focus()
          if (document.activeElement === trigger) return
        }
        if (fallbackFocus?.current?.isConnected) fallbackFocus.current.focus()
      }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => {
            e.preventDefault()
            onConfirm()
            onOpenChange(false)
          }}>{confirmText}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
