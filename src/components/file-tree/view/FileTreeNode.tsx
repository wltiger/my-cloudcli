import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Folder, FolderOpen, MoreVertical } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { FileTreeNode as FileTreeNodeType, FileTreeViewMode } from '../types/types';
import { Input } from '../../../shared/view/ui';
import FileContextMenu, { type FileContextMenuTrigger } from './FileContextMenu';

type FileTreeNodeProps = {
  item: FileTreeNodeType;
  level: number;
  viewMode: FileTreeViewMode;
  expandedDirs: Set<string>;
  onItemClick: (item: FileTreeNodeType) => void;
  renderFileIcon: (filename: string) => ReactNode;
  formatFileSize: (bytes?: number) => string;
  formatRelativeTime: (date?: string) => string;
  onRename?: (item: FileTreeNodeType) => void;
  onDelete?: (item: FileTreeNodeType) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onCopyPath?: (item: FileTreeNodeType) => void;
  onCopyRelativePath?: (item: FileTreeNodeType) => void;
  onDownload?: (item: FileTreeNodeType) => void;
  onRefresh?: () => void;
  // Rename state for inline editing
  renamingItem?: FileTreeNodeType | null;
  renameValue?: string;
  setRenameValue?: (value: string) => void;
  handleConfirmRename?: () => void;
  handleCancelRename?: () => void;
  renameInputRef?: RefObject<HTMLInputElement>;
  operationLoading?: boolean;
};

type TreeItemIconProps = {
  item: FileTreeNodeType;
  isOpen: boolean;
  renderFileIcon: (filename: string) => ReactNode;
};

function TreeItemIcon({ item, isOpen, renderFileIcon }: TreeItemIconProps) {
  if (item.type === 'directory') {
    return (
      <span className="flex flex-shrink-0 items-center gap-0.5">
        <ChevronRight
          className={cn(
            'w-3.5 h-3.5 text-muted-foreground/70 transition-transform duration-150',
            isOpen && 'rotate-90',
          )}
        />
        {isOpen ? (
          <FolderOpen className="h-4 w-4 flex-shrink-0 text-blue-500" />
        ) : (
          <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
      </span>
    );
  }

  return <span className="ml-[18px] flex flex-shrink-0 items-center">{renderFileIcon(item.name)}</span>;
}

// Touch devices have no right-click, so every row carries its own menu button there.
function RowMenuButton({ trigger, label }: { trigger: FileContextMenuTrigger; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="-mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent md:hidden"
      // Keep the row's long-press and click handlers out of the button's own gesture.
      onTouchStart={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        trigger.openMenuNearElement(event.currentTarget);
      }}
    >
      <MoreVertical className="h-4 w-4" />
    </button>
  );
}

export default function FileTreeNode({
  item,
  level,
  viewMode,
  expandedDirs,
  onItemClick,
  renderFileIcon,
  formatFileSize,
  formatRelativeTime,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onCopyRelativePath,
  onDownload,
  onRefresh,
  renamingItem,
  renameValue,
  setRenameValue,
  handleConfirmRename,
  handleCancelRename,
  renameInputRef,
  operationLoading,
}: FileTreeNodeProps) {
  const { t } = useTranslation();
  const isDirectory = item.type === 'directory';
  const isOpen = isDirectory && expandedDirs.has(item.path);
  const hasChildren = Boolean(isDirectory && item.children && item.children.length > 0);
  const isRenaming = renamingItem?.path === item.path;

  const nameClassName = cn(
    'text-[13px] leading-tight truncate',
    isDirectory ? 'font-medium text-foreground' : 'text-foreground/90',
  );

  // View mode only changes the row layout; selection, expansion, and recursion stay shared.
  const rowClassName = cn(
    viewMode === 'detailed'
      ? 'group grid grid-cols-12 gap-2 py-[3px] pr-2 hover:bg-accent/60 cursor-pointer items-center rounded-sm transition-colors duration-100'
      : viewMode === 'compact'
      ? 'group flex items-center justify-between py-[3px] pr-2 hover:bg-accent/60 cursor-pointer rounded-sm transition-colors duration-100'
      : 'group flex items-center gap-1.5 py-[3px] pr-2 cursor-pointer rounded-sm hover:bg-accent/60 transition-colors duration-100',
    isDirectory && isOpen && 'border-l-2 border-primary/30',
    (isDirectory && !isOpen) || !isDirectory ? 'border-l-2 border-transparent' : '',
  );

  // Render rename input if this item is being renamed
  if (isRenaming && setRenameValue && handleConfirmRename && handleCancelRename) {
    return (
      <div
        className={cn(rowClassName, 'bg-accent/30')}
        style={{ paddingLeft: `${level * 16 + 4}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <TreeItemIcon item={item} isOpen={isOpen} renderFileIcon={renderFileIcon} />
        <Input
          ref={renameInputRef}
          type="text"
          value={renameValue || ''}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') handleConfirmRename();
            if (e.key === 'Escape') handleCancelRename();
          }}
          onBlur={() => {
            setTimeout(() => {
              handleConfirmRename();
            }, 100);
          }}
          className="h-6 flex-1 text-sm"
          disabled={operationLoading}
        />
      </div>
    );
  }

  const renderRowContent = (trigger?: FileContextMenuTrigger) => {
    const menuButton = trigger ? (
      <RowMenuButton
        trigger={trigger}
        label={t('fileTree.context.openMenuFor', 'Open menu for {{name}}', { name: item.name })}
      />
    ) : null;

    return (
      <div
        className={rowClassName}
        style={{ paddingLeft: `${level * 16 + 4}px` }}
        onClick={() => onItemClick(item)}
      >
        {viewMode === 'detailed' ? (
          <>
            <div className="col-span-5 flex min-w-0 items-center gap-1.5">
              <TreeItemIcon item={item} isOpen={isOpen} renderFileIcon={renderFileIcon} />
              <span className={nameClassName}>{item.name}</span>
            </div>
            <div className="col-span-2 text-sm tabular-nums text-muted-foreground">
              {item.type === 'file' ? formatFileSize(item.size) : ''}
            </div>
            <div className="col-span-3 text-sm text-muted-foreground">{formatRelativeTime(item.modified)}</div>
            <div className="col-span-2 flex items-center justify-end gap-1 font-mono text-sm text-muted-foreground">
              {/* This column is too narrow on a phone to show permissions next to the menu button. */}
              <span className={cn('mr-auto truncate', menuButton && 'hidden md:inline')}>
                {item.permissionsRwx || ''}
              </span>
              {menuButton}
            </div>
          </>
        ) : viewMode === 'compact' ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              <TreeItemIcon item={item} isOpen={isOpen} renderFileIcon={renderFileIcon} />
              <span className={nameClassName}>{item.name}</span>
            </div>
            <div className="ml-2 flex flex-shrink-0 items-center gap-3 text-sm text-muted-foreground">
              {item.type === 'file' && (
                <>
                  <span className="tabular-nums">{formatFileSize(item.size)}</span>
                  <span className="font-mono">{item.permissionsRwx}</span>
                </>
              )}
              {menuButton}
            </div>
          </>
        ) : (
          <>
            <TreeItemIcon item={item} isOpen={isOpen} renderFileIcon={renderFileIcon} />
            <span className={nameClassName}>{item.name}</span>
            {menuButton && <span className="ml-auto flex items-center">{menuButton}</span>}
          </>
        )}
      </div>
    );
  };

  // Check if context menu callbacks are provided
  const hasContextMenu =
    onRename || onDelete || onNewFile || onNewFolder || onCopyPath || onCopyRelativePath || onDownload || onRefresh;

  return (
    <div className="select-none">
      {hasContextMenu ? (
        <FileContextMenu
          item={item}
          onRename={onRename}
          onDelete={onDelete}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onCopyPath={onCopyPath}
          onCopyRelativePath={onCopyRelativePath}
          onDownload={onDownload}
          onRefresh={onRefresh}
        >
          {(trigger) => renderRowContent(trigger)}
        </FileContextMenu>
      ) : (
        renderRowContent()
      )}

      {isDirectory && isOpen && hasChildren && (
        <div className="relative">
          <span
            className="absolute bottom-0 top-0 border-l border-border/40"
            style={{ left: `${level * 16 + 14}px` }}
            aria-hidden="true"
          />
          {item.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              item={child}
              level={level + 1}
              viewMode={viewMode}
              expandedDirs={expandedDirs}
              onItemClick={onItemClick}
              renderFileIcon={renderFileIcon}
              formatFileSize={formatFileSize}
              formatRelativeTime={formatRelativeTime}
              onRename={onRename}
              onDelete={onDelete}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              onCopyPath={onCopyPath}
              onCopyRelativePath={onCopyRelativePath}
              onDownload={onDownload}
              onRefresh={onRefresh}
              renamingItem={renamingItem}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              handleConfirmRename={handleConfirmRename}
              handleCancelRename={handleCancelRename}
              renameInputRef={renameInputRef}
              operationLoading={operationLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}
