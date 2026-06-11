export class NoOpCompressor {
    shouldCompress() {
        return false;
    }
    async compress(messages) {
        return messages;
    }
}
//# sourceMappingURL=no-op-compressor.js.map