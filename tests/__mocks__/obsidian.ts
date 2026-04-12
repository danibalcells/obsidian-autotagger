export class Plugin {
  app: unknown = {};
  manifest: unknown = {};
  loadData = async () => ({});
  saveData = async (_data: unknown) => {};
  addCommand = (_cmd: unknown) => {};
  addSettingTab = (_tab: unknown) => {};
  registerEvent = (_evt: unknown) => {};
}

export class PluginSettingTab {
  containerEl = {
    empty: () => {},
    createEl: (_tag: string, _opts?: unknown) => ({
      style: {},
      addEventListener: () => {},
    }),
  };
  constructor(
    public app: unknown,
    public plugin: unknown
  ) {}
  display(): void {}
}

export class Modal {
  contentEl = {
    empty: () => {},
    createEl: (_tag: string, _opts?: unknown): Record<string, unknown> => ({
      style: {},
      addEventListener: () => {},
    }),
  };
  constructor(public app: unknown) {}
  open(): void {}
  close(): void {}
}

export class Setting {
  constructor(_containerEl: unknown) {}
  setName(_name: string) {
    return this;
  }
  setDesc(_desc: string) {
    return this;
  }
  addText(_fn: unknown) {
    return this;
  }
  addTextArea(_fn: unknown) {
    return this;
  }
  addToggle(_fn: unknown) {
    return this;
  }
  addDropdown(_fn: unknown) {
    return this;
  }
  addButton(_fn: unknown) {
    return this;
  }
}

export class Notice {
  constructor(_message: string) {}
}

export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "md";
  stat = { mtime: 0, ctime: 0, size: 0 };
}

export class TFolder {
  path = "";
  name = "";
}

export class TAbstractFile {
  path = "";
  name = "";
}

export const Platform = {
  isDesktopApp: false,
  isMobileApp: false,
};

export function requestUrl(
  _opts: unknown
): Promise<{ json: Record<string, unknown>; text: string; status: number }> {
  return Promise.resolve({ json: {}, text: "", status: 200 });
}
