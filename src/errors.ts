export class ValidationError extends Error {
  constructor(message: string, _context?: Record<string, unknown>) {
    super(message);
    this.name = "ValidationError";
  }
}
