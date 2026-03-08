import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import ThreadSidebar from "../components/Sidebar";
import { cleanupActiveAccountByProvider } from "../components/AccountManagerPanel.state";
import { useAppSettings } from "../appSettings";
import { readNativeApi } from "../nativeApi";
import { Sidebar, SidebarProvider } from "~/components/ui/sidebar";

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
