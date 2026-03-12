import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { ZapIcon } from "lucide-react";

import {
  APP_SERVICE_TIER_OPTIONS,
  useAppSettings,
} from "../appSettings";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { ensureNativeApi } from "../nativeApi";
import { AccountManagerPanel } from "../components/AccountManagerPanel";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { SETTINGS_SURFACE_MODE } from "../settingsPresentation";
import { SidebarInset } from "~/components/ui/sidebar";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
  },
] as const;

function SettingsRouteView() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, defaults, updateSettings } = useAppSettings();
  const queryClient = useQueryClient();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const [isKeybindingsDialogOpen, setIsKeybindingsDialogOpen] = useState(false);
  const [isKeybindingsLoading, setIsKeybindingsLoading] = useState(false);
  const [isKeybindingsSaving, setIsKeybindingsSaving] = useState(false);
  const [keybindingsDraft, setKeybindingsDraft] = useState("");
  const [keybindingsDialogError, setKeybindingsDialogError] = useState<string | null>(null);
  const keybindingsRequestVersionRef = useRef(0);
  const keybindingsDraftDirtyRef = useRef(false);
  const codexServiceTier = settings.codexServiceTier;
  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const isModalSurface = SETTINGS_SURFACE_MODE === "modal";

  const closeKeybindingsEditor = useCallback(() => {
    keybindingsRequestVersionRef.current += 1;
    setIsKeybindingsDialogOpen(false);
    setIsKeybindingsLoading(false);
    setIsKeybindingsSaving(false);
  }, []);

  const openKeybindingsEditor = useCallback(() => {
    setKeybindingsDialogError(null);
    setIsKeybindingsDialogOpen(true);
    keybindingsDraftDirtyRef.current = false;
    const fallbackDraft = serverConfigQuery.data?.keybindings
      ? `${JSON.stringify(serverConfigQuery.data.keybindings, null, 2)}\n`
      : "";
    const hasFallbackDraft = fallbackDraft.length > 0;
    setKeybindingsDraft(fallbackDraft);
    setIsKeybindingsLoading(!hasFallbackDraft);
    const requestVersion = ++keybindingsRequestVersionRef.current;
    const api = ensureNativeApi();
    void api.server
      .getKeybindingsConfig()
      .then((result) => {
        if (requestVersion !== keybindingsRequestVersionRef.current) {
          return;
        }
        if (!keybindingsDraftDirtyRef.current) {
          setKeybindingsDraft(result.contents);
        }
        setKeybindingsDialogError(null);
      })
      .catch((error) => {
        if (requestVersion !== keybindingsRequestVersionRef.current) {
          return;
        }
        if (!hasFallbackDraft) {
          setKeybindingsDialogError(
            error instanceof Error ? error.message : "Unable to load keybindings config.",
          );
          return;
        }

        // Keep the editor usable with fallback data when background refresh fails.
        setKeybindingsDialogError(null);
      })
      .finally(() => {
        if (requestVersion !== keybindingsRequestVersionRef.current) {
          return;
        }
        setIsKeybindingsLoading(false);
      });
  }, [serverConfigQuery.data?.keybindings]);

  const saveKeybindingsEditor = useCallback(() => {
    setKeybindingsDialogError(null);
    setIsKeybindingsSaving(true);
    const api = ensureNativeApi();
    void api.server
      .setKeybindingsConfig({ contents: keybindingsDraft })
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: serverConfigQueryOptions().queryKey });
        closeKeybindingsEditor();
      })
      .catch((error) => {
        setKeybindingsDialogError(
          error instanceof Error ? error.message : "Unable to save keybindings config.",
        );
      })
      .finally(() => {
        setIsKeybindingsSaving(false);
      });
  }, [closeKeybindingsEditor, keybindingsDraft, queryClient]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && !isModalSurface && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
          </div>
        )}

        <div className={isModalSurface ? "relative flex-1 overflow-y-auto p-6" : "flex-1 overflow-y-auto p-6"}>
          {isModalSurface ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-black/35"
            />
          ) : null}
          <div
            className={
              isModalSurface
                ? "relative mx-auto flex w-full max-w-4xl flex-col gap-6 rounded-2xl border border-border bg-background p-6 shadow-2xl"
                : "mx-auto flex w-full max-w-3xl flex-col gap-6"
            }
          >
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure app-level preferences for this device.
              </p>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Appearance</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose how T3 Code handles light and dark mode.
                </p>
              </div>

              <div className="space-y-2" role="radiogroup" aria-label="Theme preference">
                {THEME_OPTIONS.map((option) => {
                  const selected = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-primary/60 bg-primary/8 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                      onClick={() => setTheme(option.value)}
                    >
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{option.label}</span>
                        <span className="text-xs">{option.description}</span>
                      </span>
                      {selected ? (
                        <span className="rounded bg-primary/14 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                          Selected
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                Active theme: <span className="font-medium text-foreground">{resolvedTheme}</span>
              </p>
            </section>

            <AccountManagerPanel />

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Models</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Configure default model behavior for Codex sessions.
                </p>
              </div>

              <div className="space-y-5">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Default service tier</span>
                  <Select
                    items={APP_SERVICE_TIER_OPTIONS.map((option) => ({
                      label: option.label,
                      value: option.value,
                    }))}
                    value={codexServiceTier}
                    onValueChange={(value) => {
                      if (!value) return;
                      updateSettings({ codexServiceTier: value });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {APP_SERVICE_TIER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div className="flex min-w-0 items-center gap-2">
                            {option.value === "fast" ? (
                              <ZapIcon className="size-3.5 text-amber-500" />
                            ) : (
                              <span className="size-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate">{option.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    {APP_SERVICE_TIER_OPTIONS.find((option) => option.value === codexServiceTier)
                      ?.description ?? "Use Codex defaults without forcing a service tier."}
                  </span>
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Responses</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control how assistant output is rendered during a turn.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Stream assistant messages</p>
                  <p className="text-xs text-muted-foreground">
                    Show token-by-token output while a response is in progress.
                  </p>
                </div>
                <Switch
                  checked={settings.enableAssistantStreaming}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      enableAssistantStreaming: Boolean(checked),
                    })
                  }
                  aria-label="Stream assistant messages"
                />
              </div>

              {settings.enableAssistantStreaming !== defaults.enableAssistantStreaming ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        enableAssistantStreaming: defaults.enableAssistantStreaming,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Keybindings</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Edit persisted <code>keybindings.json</code> directly in the app.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">Config file path</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {keybindingsConfigPath ?? "Resolving keybindings path..."}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={isKeybindingsLoading}
                    onClick={openKeybindingsEditor}
                  >
                    {isKeybindingsLoading ? "Loading..." : "Edit keybindings JSON"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Add or update bindings as JSON array entries.
                </p>
                {keybindingsDialogError ? (
                  <p className="text-xs text-destructive">{keybindingsDialogError}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Safety</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Additional guardrails for destructive local actions.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Confirm thread deletion</p>
                  <p className="text-xs text-muted-foreground">
                    Ask for confirmation before deleting a thread and its chat history.
                  </p>
                </div>
                <Switch
                  checked={settings.confirmThreadDelete}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      confirmThreadDelete: Boolean(checked),
                    })
                  }
                  aria-label="Confirm thread deletion"
                />
              </div>

              {settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        confirmThreadDelete: defaults.confirmThreadDelete,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
      <Dialog
        open={isKeybindingsDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsKeybindingsDialogOpen(true);
            return;
          }
          closeKeybindingsEditor();
        }}
      >
        <DialogPopup className="max-h-[90vh] max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit keybindings JSON</DialogTitle>
            <DialogDescription>
              Modify <code>keybindings.json</code> directly. Use a JSON array of keybinding rules.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="min-h-0 space-y-3" scrollFade={false}>
            <p className="text-xs text-muted-foreground">
              {keybindingsConfigPath ?? "Resolving keybindings path..."}
            </p>
            <Textarea
              value={keybindingsDraft}
              onChange={(event) => {
                keybindingsDraftDirtyRef.current = true;
                setKeybindingsDraft(event.target.value);
              }}
              className="w-full overflow-hidden font-mono text-xs"
              spellCheck={false}
              disabled={isKeybindingsLoading || isKeybindingsSaving}
              aria-label="Keybindings JSON"
              style={{
                height: "360px",
                minHeight: "220px",
                maxHeight: "60vh",
                resize: "vertical",
              }}
              placeholder='[\n  { "key": "mod+b", "command": "sidebar.project.toggle" }\n]'
            />
            {keybindingsDialogError ? (
              <p className="text-xs text-destructive">{keybindingsDialogError}</p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              disabled={isKeybindingsSaving}
              onClick={closeKeybindingsEditor}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isKeybindingsLoading || isKeybindingsSaving}
              onClick={saveKeybindingsEditor}
            >
              {isKeybindingsSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
