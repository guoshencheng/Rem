import { runtimeStorageContract } from './runtime-storage-contract.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

runtimeStorageContract(createFakeRuntimeStore);
