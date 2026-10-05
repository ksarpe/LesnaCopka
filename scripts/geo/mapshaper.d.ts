declare module 'mapshaper' {
  const mapshaper: {
    /** Uruchamia polecenia CLI mapshapera; zwraca pliki wyjściowe (nazwa → zawartość). */
    applyCommands(commands: string, input?: Record<string, unknown>): Promise<Record<string, string | Buffer>>;
  };
  export default mapshaper;
}
