export interface SourceFile {
  id: string;
  name: string;
  modifiedAt: string | null;
  size: number;
  hash?: string;
}

export interface ContractSource {
  list(): Promise<SourceFile[]>;
  fetch(id: string): Promise<Buffer>;
}

export class UploadSource implements ContractSource {
  private readonly filesById = new Map<string, { metadata: SourceFile; buffer: Buffer }>();

  constructor(files: Array<{ originalname: string; size: number; buffer: Buffer; id: string; hash: string }>) {
    for (const file of files) {
      this.filesById.set(file.id, {
        metadata: {
          id: file.id,
          name: file.originalname,
          modifiedAt: null,
          size: file.size,
          hash: file.hash,
        },
        buffer: file.buffer,
      });
    }
  }

  async list() {
    return [...this.filesById.values()].map(({ metadata }) => metadata);
  }

  async fetch(id: string) {
    const sourceFile = this.filesById.get(id);
    if (!sourceFile) throw new Error(`Upload source file ${id} was not found.`);
    return sourceFile.buffer;
  }
}