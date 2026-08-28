// CommandManager.js — istoricul actiunilor. Fiecare comanda salveaza un snapshot
// de stare (figura + modul de legare a textului), nu pixeli.

export class CommandManager {
  constructor() { this.past = []; this.future = []; }

  push(state) { this.past.push(state); this.future.length = 0; }

  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }

  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
