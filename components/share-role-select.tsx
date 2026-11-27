'use client'

import { useState } from 'react'
import { Selector } from '@astryxdesign/core/Selector'

export default function ShareRoleSelect({
  label,
  defaultValue,
  canViewLabel,
  canEditLabel,
}: {
  label: string
  defaultValue: 'viewer' | 'editor'
  canViewLabel: string
  canEditLabel: string
}) {
  const [role, setRole] = useState<'viewer' | 'editor'>(defaultValue)
  return (
    <Selector
      label={label}
      htmlName="role"
      size="sm"
      value={role}
      options={[
        { value: 'viewer', label: canViewLabel },
        { value: 'editor', label: canEditLabel },
      ]}
      onChange={value => setRole(value === 'editor' ? 'editor' : 'viewer')}
    />
  )
}
