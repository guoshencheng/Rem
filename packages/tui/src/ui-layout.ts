import type { CliRenderer } from "@opentui/core";
import {
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  TextAttributes,
} from "@opentui/core";

export interface UILayout {
  statusText: TextRenderable;
  inputNode: InputRenderable;
  overlayBox: BoxRenderable;
  chatBox: BoxRenderable;
}

export function buildUI(renderer: CliRenderer): UILayout {
  const statusText = new TextRenderable(renderer, {
    content: "",
    attributes: TextAttributes.DIM,
  });

  const inputNode = new InputRenderable(renderer, {
    placeholder: "Type a message...",
    width: "100%",
  });

  const overlayBox = new BoxRenderable(renderer, {
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    zIndex: 100,
    visible: false,
  });

  const chatBox = new BoxRenderable(renderer, {
    flexDirection: "column",
    gap: 1,
  });

  const scrollBox = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyStart: "bottom",
  });
  scrollBox.add(chatBox);

  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    height: "100%",
  });
  root.add(scrollBox);
  root.add(statusText);

  const inputRow = new BoxRenderable(renderer, { marginTop: 1 });
  inputRow.add(inputNode);
  root.add(inputRow);

  root.add(overlayBox);

  renderer.root.add(root);

  return { statusText, inputNode, overlayBox, chatBox };
}
