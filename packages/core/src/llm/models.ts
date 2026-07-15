import { createModels } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { Models, Provider } from '@earendil-works/pi-ai';

export interface CreateCoreModelsOptions {
  /** 是否注册 pi-ai 全部内置 provider。默认 false（只创建空 Models，便于测试）。 */
  all?: boolean;
  /** 自定义 provider */
  customProviders?: Provider[];
}

export function createCoreModels(options?: CreateCoreModelsOptions): Models {
  const models = options?.all ? builtinModels() : createModels();
  for (const provider of options?.customProviders ?? []) {
    models.setProvider(provider);
  }
  return models;
}
