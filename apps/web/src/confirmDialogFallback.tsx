import { useEffect } from "react";

import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./components/ui/dialog";
import { useConfirmDialogState } from "./confirmDialogFallbackStore";

export function ConfirmDialogFallbackHost() {
  const activeRequest = useConfirmDialogState((state) => state.queue[0] ?? null);
  const resolveRequest = useConfirmDialogState((state) => state.resolveRequest);
  const clearAll = useConfirmDialogState((state) => state.clearAll);

  useEffect(
    () => () => {
      clearAll();
    },
    [clearAll],
  );

  const closeWith = (value: boolean) => {
    if (!activeRequest) return;
    resolveRequest(activeRequest.id, value);
  };

  return (
    <Dialog
      open={Boolean(activeRequest)}
      onOpenChange={(open) => {
        if (!open) {
          closeWith(false);
        }
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Please confirm</DialogTitle>
          <DialogDescription>{activeRequest?.message ?? ""}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => closeWith(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => closeWith(true)}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
