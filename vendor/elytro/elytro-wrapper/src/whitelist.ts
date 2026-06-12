export function isAllowed(cmd: string): boolean {
    return cmd.startsWith('elytro ');
}
