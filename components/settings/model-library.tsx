'use client'

import { invoke } from '@tauri-apps/api/core'
import { ArrowDownToLine, ArrowUpRight, Check, Plus, Search } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog as AstryxDialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Heading } from '@astryxdesign/core/Heading'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import type { CatalogModel, LocalLibrary, LocalModel } from '../../desktop/local-models'

export default function ModelLibrary({ library, selected, onSelect, refresh, onClose }: {
  library?: LocalLibrary; selected: string | null; onSelect: (id: string | null) => void
  refresh: () => Promise<LocalLibrary | undefined>; onClose?: () => void
}) {
  const t = useTranslations('desktop')
  const locale = useLocale()
  const [tab, setTab] = useState<'discover' | 'installed'>(selected ? 'installed' : 'discover')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<{ model: LocalModel; partial: boolean }>()

  useEffect(() => {
    const timer = setInterval(() => { void refresh() }, 900)
    return () => clearInterval(timer)
  }, [refresh])

  async function run(work: () => Promise<void>) {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await work()
    } catch (error) {
      setError(typeof error === 'string' ? error : t('modelLibraryError'))
    } finally {
      setBusy(false)
    }
  }

  async function importModel() {
    const model = await invoke<LocalModel | null>('import_local_model')
    if (!model) return
    await refresh()
    onSelect(model.id)
    setTab('installed')
  }

  async function removeModel(model: LocalModel, partial: boolean) {
    await invoke(partial ? 'discard_model_download' : 'remove_local_model', { id: model.id })
    if (!partial && model.id === selected) onSelect(null)
    await refresh()
    setRemoving(undefined)
  }

  async function transfer(model: CatalogModel, command: 'download_local_model' | 'pause_model_download') {
    await invoke(command, { id: model.id })
    await refresh()
  }

  function formatSize(bytes: number) {
    const unit = bytes >= 1024 ** 3 ? 'GiB' : 'MiB'
    const size = bytes / (unit === 'GiB' ? 1024 ** 3 : 1024 ** 2)
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size) + ' ' + unit
  }

  function renderCatalog(model: CatalogModel) {
    const installed = library?.models.some(item => item.id === model.id)
    const capacity = library?.capacity
    const needsMemory = capacity?.totalMemory != null && model.memory > capacity.totalMemory
    const needsDisk = capacity?.freeDisk != null && model.bytes - model.downloaded > capacity.freeDisk
    const hasRoom = !!library?.runtimeAvailable && capacity?.totalMemory != null && capacity.freeDisk != null && !needsMemory && !needsDisk
    const active = ['downloading', 'verifying', 'pausing'].includes(model.phase)
    const progressing = active || model.downloaded > 0
    const progress = t('modelProgress', { downloaded: formatSize(model.downloaded), total: formatSize(model.bytes) })

    return (
      <li className="model-catalog-row" key={model.id}>
        <VStack gap={1.5}>
          <HStack justify="between" align="center" gap={2}>
            <Heading level={3}>{model.label}</Heading>
            <IconButton
              variant="ghost"
              size="sm"
              href={'https://huggingface.co/' + model.repository}
              target="_blank"
              rel="noopener noreferrer"
              label={t('openModelSource', { model: model.label })}
              tooltip={t('openModelSource', { model: model.label })}
              icon={<ArrowUpRight size={16} />}
            />
          </HStack>
          <Text size="sm" color="secondary">{t('modelStrength_' + model.strength)}</Text>
          <Text type="supporting" color="secondary">
            {formatSize(model.bytes)} · Q4_K_M · {t('modelMemoryEstimate', { memory: formatSize(model.memory) })}
          </Text>
          {!installed && !active && hasRoom && (
            <HStack gap={1} align="center">
              <Check size={14} aria-hidden="true" />
              <Text type="supporting" color="secondary">{t('fitsDevice')}</Text>
            </HStack>
          )}
          {!installed && progressing && (
            <VStack gap={1}>
              <ProgressBar
                label={t('modelDownloadProgress', { model: model.label })}
                isLabelHidden
                value={model.downloaded}
                max={model.bytes}
              />
              <Text type="supporting" color="secondary">
                {model.phase === 'verifying' ? t('verifyingModel') : model.phase === 'pausing' ? t('pausingModel') : progress}
              </Text>
            </VStack>
          )}
          {!installed && model.error && (
            <Text type="supporting" role="status" className="account-error">{t('modelTransferError_' + model.error)}</Text>
          )}
          {!installed && !active && (needsMemory || needsDisk) && (
            <Text type="supporting" color="secondary">{t(needsMemory ? 'lowModelMemory' : 'lowModelDisk')}</Text>
          )}
          <HStack gap={2} wrap="wrap">
            {installed ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Check size={15} />}
                label={t('modelInstalledBadge')}
                onClick={() => setTab('installed')}
              />
            ) : active ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                isDisabled={busy || model.phase === 'pausing'}
                label={t('pauseModelDownload')}
                onClick={() => void run(() => transfer(model, 'pause_model_download'))}
              />
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<ArrowDownToLine size={16} />}
                isDisabled={busy || !library?.runtimeAvailable || needsMemory || needsDisk}
                label={t(model.downloaded ? 'resumeModelDownload' : 'downloadModel')}
                onClick={() => void run(() => transfer(model, 'download_local_model'))}
              />
            )}
            {!installed && !active && model.downloaded > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                isDisabled={busy}
                label={t('discardPartialModel')}
                onClick={() => setRemoving({ model, partial: true })}
              />
            )}
          </HStack>
        </VStack>
      </li>
    )
  }

  const matching = library?.catalog.filter(model => model.label.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))) ?? []
  const used = library?.models.reduce((total, model) => total + model.bytes, 0) ?? 0

  const body = (
    <VStack gap={3} className={onClose ? undefined : 'embedded-model-library'}>
      {!onClose && <Heading level={2}>{t('modelLibrary')}</Heading>}
      <Text color="secondary">{t('localModelDescription')}</Text>
      {!library ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isDisabled={busy}
          label={t('modelLibraryRetry')}
          onClick={() => void run(async () => {
            if (!await refresh()) throw new Error(t('modelLibraryError'))
          })}
        />
      ) : !library.runtimeAvailable && (
        <div role="status">
          <Banner status="warning" collapsible={false} title={t('localRuntimeUnavailable')} />
        </div>
      )}
      <SegmentedControl
        label={t('modelLibrary')}
        value={tab}
        onChange={value => setTab(value === 'installed' ? 'installed' : 'discover')}
        size="sm"
      >
        <SegmentedControlItem value="discover" label={t('discoverModels')} />
        <SegmentedControlItem value="installed" label={t('installedModels')} />
      </SegmentedControl>
      {tab === 'discover' ? (
        <VStack gap={3}>
          <TextInput
            type="search"
            label={t('searchModels')}
            isLabelHidden
            placeholder={t('searchModels')}
            startIcon={<Search size={16} aria-hidden="true" />}
            width="100%"
            value={query}
            onChange={setQuery}
          />
          {!!matching.length && <ul className="model-catalog">{matching.map(renderCatalog)}</ul>}
          {library && !matching.length && <Text color="secondary">{t('noMatchingModels')}</Text>}
        </VStack>
      ) : (
        <VStack gap={3}>
          <Text type="supporting" color="secondary">
            {t('modelStorageUsed', { used: formatSize(used) })}
            {library?.capacity.freeDisk != null && ' · ' + t('modelStorageFree', { free: formatSize(library.capacity.freeDisk) })}
          </Text>
          {!!library?.models.length && (
            <VStack gap={1} className="assistant-connections">
              {library.models.map(model => (
                <Item
                  key={model.id}
                  density="compact"
                  startContent={selected === model.id ? <Check size={14} aria-hidden="true" /> : undefined}
                  label={model.label}
                  description={formatSize(model.bytes)}
                  isSelected={selected === model.id}
                  isDisabled={busy || !library.runtimeAvailable}
                  onClick={() => onSelect(model.id)}
                  endContent={
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      isDisabled={busy}
                      label={t('removeLocalModel')}
                      onClick={event => { event.stopPropagation(); setRemoving({ model, partial: false }) }}
                    />
                  }
                />
              ))}
            </VStack>
          )}
        </VStack>
      )}
      {error && (
        <div role="alert">
          <Banner status="error" collapsible={false} title={error} />
        </div>
      )}
      {!onClose && (
        <HStack justify="end">
          <Button
            type="button"
            variant="primary"
            icon={<Plus size={16} aria-hidden="true" />}
            isDisabled={busy || !library?.runtimeAvailable}
            label={busy ? t('workingWithModels') : t('importLocalModel')}
            onClick={() => void run(importModel)}
          />
        </HStack>
      )}
      {removing && (
        <AlertDialog
          isOpen
          onOpenChange={open => { if (!open) setRemoving(undefined) }}
          title={removing.model.label}
          description={t(removing.partial ? 'confirmDiscardModel' : 'confirmRemoveModel', { model: removing.model.label })}
          cancelLabel={t('cancelModelAction')}
          actionLabel={t(removing.partial ? 'discardPartialModel' : 'removeLocalModel')}
          actionVariant="destructive"
          isActionLoading={busy}
          onAction={() => void run(() => removeModel(removing.model, removing.partial))}
        />
      )}
    </VStack>
  )

  if (!onClose) return body

  return (
    <AstryxDialog isOpen onOpenChange={open => { if (!open) onClose() }} className="model-library-dialog" width={600} padding={0}>
      <Layout
        header={<DialogHeader title={t('modelLibrary')} onOpenChange={open => { if (!open) onClose() }} />}
        content={<LayoutContent>{body}</LayoutContent>}
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={2} justify="end">
              <Button type="button" variant="secondary" label={t('closeModels')} onClick={onClose} />
              <Button
                type="button"
                variant="primary"
                icon={<Plus size={16} aria-hidden="true" />}
                isDisabled={busy || !library?.runtimeAvailable}
                label={busy ? t('workingWithModels') : t('importLocalModel')}
                onClick={() => void run(importModel)}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </AstryxDialog>
  )
}
