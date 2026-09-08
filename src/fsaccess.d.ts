/* File System Access API.
 *
 * TypeScript's DOM lib does not carry these yet (they are not on the standards
 * track everywhere - Chrome and Edge implement them, Safari and Firefox do not).
 * Declared here rather than pulled in as a dependency, since we use four calls.
 */

type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
  queryPermission(desc?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(desc?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle & { kind: "file" | "directory"; name: string }>;
}

interface DirectoryPickerOptions {
  /** Groups the picker's remembered starting directory with other calls sharing this id. */
  id?: string;
  mode?: FileSystemPermissionMode;
  startIn?: FileSystemHandle | string;
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
