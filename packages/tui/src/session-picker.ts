import { Container, SelectList } from "@earendil-works/pi-tui";
import type { SelectItem, SelectListTheme } from "@earendil-works/pi-tui";
import { bold, dim } from "./colors.js";

const theme: SelectListTheme = {
  selectedPrefix: () => dim("  "),
  selectedText: (text: string) => bold(text),
  description: (text: string) => dim(text),
  scrollInfo: (text: string) => dim(text),
  noMatch: (text: string) => dim(text),
};

export interface SessionPickerItem {
  sessionId: string;
  title?: string;
  updatedAt: Date;
  messageCount: number;
}

export class SessionPicker extends Container {
  private selectList: SelectList;

  constructor(
    items: SessionPickerItem[],
    options: {
      onSelect: (sessionId: string) => void;
      onCancel: () => void;
    },
  ) {
    super();

    const selectItems: SelectItem[] = items.map((item) => ({
      value: item.sessionId,
      label: item.title ? `${item.title} (${item.sessionId.slice(0, 8)})` : item.sessionId.slice(0, 8),
      description: `${item.messageCount} messages  •  ${item.updatedAt.toLocaleString()}`,
    }));

    this.selectList = new SelectList(selectItems, 10, theme);
    this.selectList.onSelect = (sel) => {
      options.onSelect(sel.value);
    };
    this.selectList.onCancel = () => {
      options.onCancel();
    };

    this.addChild(this.selectList);
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }
}
