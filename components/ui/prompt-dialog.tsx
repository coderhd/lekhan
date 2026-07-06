import * as React from "react"
import { useState, useEffect } from "react"
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

interface PromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  onSubmit: (value: string) => void
  onCancel?: () => void
  submitText?: string
  cancelText?: string
  placeholder?: string
  defaultValue?: string
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  onCancel,
  submitText = "Submit",
  cancelText = "Cancel",
  placeholder = "",
  defaultValue = "",
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    if (open) {
      setValue(defaultValue)
    }
  }, [open, defaultValue])

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    onSubmit(value)
    onOpenChange(false)
  }

  const handleCancel = (e?: React.MouseEvent) => {
    if (e) e.preventDefault()
    onCancel?.()
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <form onSubmit={handleSubmit}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <div className="py-4">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:ring-2 focus:ring-primary-container/50 focus:border-primary-container outline-none premium-transition"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel} type="button">{cancelText}</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} type="submit">{submitText}</AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
