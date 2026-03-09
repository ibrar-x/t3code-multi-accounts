import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { type ResolvedKeybindingsConfig } from "@t3tools/contracts";

import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import ThreadSidebar from "../components/Sidebar";
import { cleanupActiveAccountByProvider } from "../components/AccountManagerPanel.state";
import { useAppSettings } from "../appSettings";
import { resolveShortcutCommand } from "../keybindings";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { Sidebar, SidebarProvider, useSidebar } from "~/components/ui/sidebar";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

function isTerminalFocusedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.classList.contains("xterm-helper-textarea")) return true;
  return target.closest(".thread-terminal-drawer .xterm") !== null;
}

function ProjectSidebarShortcutHandler() {
  const { toggleSidebar } = useSidebar();
  const { data: serverConfig } = useQuery(serverConfigQueryOptions());
  const keybindings = serverConfig?.keybindings ?? EMPTY_KEYBINDINGS;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableEventTarget(event.target)) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocusedTarget(event.target),
          terminalOpen: false,
        },
      });
      if (command !== "sidebar.project.toggle") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, toggleSidebar]);

  return null;
}

function ChatRouteLayout() {
  const navigate = useNavigate();
  const { settings, updateSettings } = useAppSettings();
  const startupAccountCheckRef = useRef(false);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  useEffect(() => {
    if (startupAccountCheckRef.current) {
      return;
    }

    const accounts = settings.multiAccount.accounts;
    if (accounts.length === 0) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }
    startupAccountCheckRef.current = true;

    let cancelled = false;
    void api.accounts
      .list({ accounts })
      .then((response) => {
        if (cancelled) return;
        const nextAccounts = response.accounts;
        const nextActive = cleanupActiveAccountByProvider(
          settings.multiAccount.activeAccountByProvider,
          nextAccounts,
        );
        updateSettings({
          multiAccount: {
            accounts: nextAccounts,
            activeAccountByProvider: nextActive,
          },
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [settings.multiAccount.accounts, settings.multiAccount.activeAccountByProvider, updateSettings]);

  return (
    <SidebarProvider defaultOpen>
      <ProjectSidebarShortcutHandler />
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border bg-card text-foreground"
      >
        <ThreadSidebar />
      </Sidebar>
      <DiffWorkerPoolProvider>
        <Outlet />
      </DiffWorkerPoolProvider>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
