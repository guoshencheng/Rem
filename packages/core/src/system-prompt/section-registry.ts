import type { PromptSection, PromptSectionRegistry } from '../sdk/system-prompt.js';
import {
  PromptSectionIdentityError,
  PromptSectionNotFoundError,
  ProtectedPromptSectionError,
} from '../plugin-system/errors.js';

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const RUNTIME_SECTION = 'runtime';

interface SectionEntry {
  section: PromptSection;
  source: string;
  history: string[];
}

export interface PromptSectionDiagnostic {
  readonly name: string;
  readonly source: string;
  readonly history: readonly string[];
}

function cloneEntries(entries: readonly SectionEntry[]): SectionEntry[] {
  return entries.map((entry) => ({ ...entry, history: [...entry.history] }));
}

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new PromptSectionIdentityError(`Invalid prompt section name: ${name}`);
  }
}

class PromptSectionRegistryTransaction implements PromptSectionRegistry {
  private active = true;

  constructor(
    private readonly entries: SectionEntry[],
    private readonly source: string,
  ) {}

  set(name: string, section: PromptSection): void {
    this.assertActive();
    assertName(name);
    if (name !== section.name) {
      throw new PromptSectionIdentityError(
        `Prompt section identity mismatch: ${name} !== ${section.name}`,
      );
    }
    const current = this.entries.findIndex((entry) => entry.section.name === name);
    if (current >= 0) {
      const previous = this.entries[current];
      this.entries[current] = {
        section,
        source: this.source,
        history: [...previous.history, this.source],
      };
      return;
    }
    const runtime = this.indexOf(RUNTIME_SECTION);
    this.entries.splice(runtime, 0, {
      section,
      source: this.source,
      history: [this.source],
    });
  }

  delete(name: string): boolean {
    this.assertActive();
    if (name === RUNTIME_SECTION) {
      throw new ProtectedPromptSectionError('runtime cannot be deleted');
    }
    const index = this.entries.findIndex((entry) => entry.section.name === name);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  moveBefore(name: string, anchor: string): void {
    this.move(name, anchor, false);
  }

  moveAfter(name: string, anchor: string): void {
    this.move(name, anchor, true);
  }

  has(name: string): boolean {
    this.assertActive();
    return this.entries.some((entry) => entry.section.name === name);
  }

  finish(): SectionEntry[] {
    this.assertActive();
    this.active = false;
    return cloneEntries(this.entries);
  }

  abort(): void {
    this.active = false;
  }

  private move(name: string, anchor: string, after: boolean): void {
    this.assertActive();
    if (name === RUNTIME_SECTION) {
      throw new ProtectedPromptSectionError('runtime cannot be moved');
    }
    if (after && anchor === RUNTIME_SECTION) {
      throw new ProtectedPromptSectionError('no section can move after runtime');
    }
    const sourceIndex = this.indexOf(name);
    this.indexOf(anchor);
    if (name === anchor) return;
    const [entry] = this.entries.splice(sourceIndex, 1);
    const anchorIndex = this.indexOf(anchor);
    this.entries.splice(anchorIndex + (after ? 1 : 0), 0, entry);
  }

  private indexOf(name: string): number {
    const index = this.entries.findIndex((entry) => entry.section.name === name);
    if (index < 0) throw new PromptSectionNotFoundError(name);
    return index;
  }

  private assertActive(): void {
    if (!this.active) throw new Error('Prompt section registry view is no longer active');
  }
}

export class PromptSectionRegistryStore {
  private entries: SectionEntry[];

  constructor(sections: readonly PromptSection[]) {
    const names = new Set<string>();
    for (const section of sections) {
      assertName(section.name);
      if (names.has(section.name)) {
        throw new PromptSectionIdentityError(`Duplicate prompt section: ${section.name}`);
      }
      names.add(section.name);
    }
    if (sections.at(-1)?.name !== RUNTIME_SECTION) {
      throw new ProtectedPromptSectionError('runtime must be the final prompt section');
    }
    this.entries = sections.map((section) => ({
      section,
      source: 'core',
      history: ['core'],
    }));
  }

  transact(source: string, apply: (registry: PromptSectionRegistry) => void): void {
    const transaction = new PromptSectionRegistryTransaction(cloneEntries(this.entries), source);
    try {
      apply(transaction);
      this.entries = transaction.finish();
    } catch (error) {
      transaction.abort();
      throw error;
    }
  }

  finalize(): readonly PromptSection[] {
    return Object.freeze(this.entries.map((entry) => entry.section));
  }

  diagnostics(): readonly PromptSectionDiagnostic[] {
    return this.entries.map((entry) => Object.freeze({
      name: entry.section.name,
      source: entry.source,
      history: Object.freeze([...entry.history]),
    }));
  }
}
