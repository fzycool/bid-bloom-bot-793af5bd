import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { InsertPosition } from "./types";

interface AddNodeDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (title: string, position: InsertPosition) => void;
  defaultTitle?: string;
  hasSelected: boolean;
}

export default function AddNodeDialog({
  open, onClose, onConfirm, defaultTitle = "", hasSelected,
}: AddNodeDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [position, setPosition] = useState<InsertPosition>("child");

  React.useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setPosition("child");
    }
  }, [open, defaultTitle]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加大纲节点</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>标题</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入节点标题"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) {
                  onConfirm(title.trim(), position);
                }
              }}
            />
          </div>
          {hasSelected && (
            <div className="space-y-2">
              <Label>插入位置</Label>
              <Select value={position} onValueChange={(v) => setPosition(v as InsertPosition)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="child">作为子节点</SelectItem>
                  <SelectItem value="sibling">作为同级节点（之后）</SelectItem>
                  <SelectItem value="before">作为同级节点（之前）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => title.trim() && onConfirm(title.trim(), position)} disabled={!title.trim()}>
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
