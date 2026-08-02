export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryError';
  }
}
