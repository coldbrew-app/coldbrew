export function getRequestOrigin(request: Request): string {
  return new URL(request.url).origin;
}
