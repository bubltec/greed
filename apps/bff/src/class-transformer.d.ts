declare module 'class-transformer/cjs/storage.js' {
  /** Internal registry behind @Type(); read to learn a nested property's element class. */
  export const defaultMetadataStorage: {
    findTypeMetadata(target: Function, propertyName: string): { typeFunction(): unknown } | undefined;
  };
}
