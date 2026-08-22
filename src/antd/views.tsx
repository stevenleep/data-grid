import {
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  SaveOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Badge, Button, Divider, Input, Popconfirm, Popover, Space, Tooltip } from 'antd';
import { useState, type ReactNode } from 'react';
import type { GridViewState } from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { useControllableOpen } from './hooks';
import { resolveGridLocale } from './locale';

export interface GridViewPanelProps {
  className?: string;
}

export function GridViewPanel<Row extends object>({ className }: GridViewPanelProps = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const state = useGridSelector<Row, GridViewState>((current) => current.views);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const [renameValue, setRenameValue] = useState('');

  return (
    <div
      className={['hui-grid__panel', 'hui-grid__view-panel', className].filter(Boolean).join(' ')}
    >
      <div className="hui-grid__panel-heading">
        <strong>{locale.views}</strong>
        {state.activeId && state.dirty && (
          <Button
            size="small"
            type="link"
            icon={<SaveOutlined />}
            onClick={() => instance.views.save(state.activeId!)}
          >
            {locale.save}
          </Button>
        )}
      </div>
      <button className="hui-grid__view-item" type="button" onClick={() => instance.views.apply()}>
        <span>{locale.defaultView}</span>
        {!state.activeId && <CheckOutlined />}
      </button>
      {state.items.map((view) => (
        <div className="hui-grid__view-item" key={view.id}>
          {renaming === view.id ? (
            <Input
              size="small"
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={() => {
                instance.views.rename(view.id, renameValue);
                setRenaming(undefined);
              }}
              onPressEnter={() => {
                instance.views.rename(view.id, renameValue);
                setRenaming(undefined);
              }}
            />
          ) : (
            <button
              className="hui-grid__view-name"
              type="button"
              onClick={() => instance.views.apply(view.id)}
            >
              <span>{view.name}</span>
              {view.scope && view.scope !== 'private' && <small>{view.scope}</small>}
            </button>
          )}
          {state.activeId === view.id && <Badge status={state.dirty ? 'warning' : 'success'} />}
          {!view.readonly && (
            <>
              <Tooltip title={locale.rename}>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setRenaming(view.id);
                    setRenameValue(view.name);
                  }}
                />
              </Tooltip>
              <Tooltip title={locale.duplicate}>
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={() => instance.views.duplicate(view.id)}
                />
              </Tooltip>
              <Popconfirm
                title={`${locale.remove} ${view.name}?`}
                onConfirm={() => instance.views.remove(view.id)}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
        </div>
      ))}
      <Divider />
      <Space.Compact block>
        <Input
          size="small"
          value={name}
          placeholder={locale.viewName}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={() => {
            instance.views.create(name);
            setName('');
          }}
        />
        <Button
          size="small"
          type="primary"
          disabled={!name.trim()}
          onClick={() => {
            instance.views.create(name);
            setName('');
          }}
        >
          {locale.newView}
        </Button>
      </Space.Compact>
    </div>
  );
}

export interface GridViewTriggerProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?:
    ReactNode | ((context: { open: boolean; activeName: string; dirty: boolean }) => ReactNode);
  placement?: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight';
}

export function GridViewTrigger<Row extends object>({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  trigger,
  placement = 'bottomLeft',
}: GridViewTriggerProps = {}) {
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const state = useGridSelector<Row, GridViewState>((current) => current.views);
  const [open, setOpen] = useControllableOpen(controlled, defaultOpen, onOpenChange);
  const activeName =
    state.items.find((view) => view.id === state.activeId)?.name || locale.defaultView;
  const button =
    typeof trigger === 'function'
      ? trigger({ open, activeName, dirty: state.dirty })
      : trigger || (
          <Button size="small" type="text" icon={<UnorderedListOutlined />}>
            {activeName}
            {state.dirty ? ' •' : ''}
          </Button>
        );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement={placement}
      destroyOnHidden
      content={<GridViewPanel<Row> />}
    >
      <span>{button}</span>
    </Popover>
  );
}
