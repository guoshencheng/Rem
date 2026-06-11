import type { ContextCompressor } from '../sdk/compressor.js';
import type { ModelMessage } from '../types.js';
export declare class NoOpCompressor implements ContextCompressor {
    shouldCompress(): boolean;
    compress(messages: ModelMessage[]): Promise<ModelMessage[]>;
}
//# sourceMappingURL=no-op-compressor.d.ts.map