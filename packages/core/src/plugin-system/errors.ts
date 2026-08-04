export class InvalidPluginNameError extends Error {
  constructor(readonly pluginName: string) {
    super(`Invalid plugin name: ${pluginName}`);
    this.name = 'InvalidPluginNameError';
  }
}

export class DuplicatePluginNameError extends Error {
  constructor(readonly pluginName: string) {
    super(`Duplicate plugin name: ${pluginName}`);
    this.name = 'DuplicatePluginNameError';
  }
}

export class PromptSectionIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptSectionIdentityError';
  }
}

export class ProtectedPromptSectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtectedPromptSectionError';
  }
}

export class PromptSectionNotFoundError extends Error {
  constructor(readonly sectionName: string) {
    super(`Prompt section not found: ${sectionName}`);
    this.name = 'PromptSectionNotFoundError';
  }
}

export class PluginRegistrationError extends Error {
  constructor(readonly pluginName: string, cause: unknown) {
    super(`Plugin registration failed: ${pluginName}`, { cause });
    this.name = 'PluginRegistrationError';
  }
}
