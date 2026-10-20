using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace ApplyPack.Security
{
    public sealed class CredentialMaterial : IDisposable
    {
        private char[] _secret;

        internal CredentialMaterial(string userName, char[] secret)
        {
            UserName = userName;
            _secret = secret;
        }

        public string UserName { get; private set; }
        public bool HasLineBreak
        {
            get
            {
                for (int index = 0; index < _secret.Length; index += 1)
                {
                    if (_secret[index] == '\r' || _secret[index] == '\n' || _secret[index] == '\0') return true;
                }
                return false;
            }
        }

        public void WriteUtf8LineTo(Stream stream)
        {
            if (_secret == null) throw new ObjectDisposedException("CredentialMaterial");
            if (stream == null || !stream.CanWrite) throw new InvalidOperationException("CREDENTIAL_PIPE_INVALID");
            byte[] buffer = new byte[Encoding.UTF8.GetMaxByteCount(_secret.Length) + 1];
            try
            {
                int count = Encoding.UTF8.GetBytes(_secret, 0, _secret.Length, buffer, 0);
                buffer[count] = (byte)'\n';
                stream.Write(buffer, 0, count + 1);
                stream.Flush();
            }
            finally
            {
                Array.Clear(buffer, 0, buffer.Length);
            }
        }

        public void Dispose()
        {
            if (_secret != null)
            {
                Array.Clear(_secret, 0, _secret.Length);
                _secret = null;
            }
            UserName = null;
        }
    }

    public static class WindowsCredentialStore
    {
        private const uint CredTypeGeneric = 1;
        private const string StagingDatabaseTarget = "ApplyPack/Supabase/Staging/Database";

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NativeCredential
        {
            public uint Flags;
            public uint Type;
            public string TargetName;
            public string Comment;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            public uint CredentialBlobSize;
            public IntPtr CredentialBlob;
            public uint Persist;
            public uint AttributeCount;
            public IntPtr Attributes;
            public string TargetAlias;
            public string UserName;
        }

        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern void CredFree(IntPtr credentialPtr);

        public static CredentialMaterial ReadStagingDatabase()
        {
            string target = StagingDatabaseTarget;
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                throw new InvalidOperationException("WINDOWS_REQUIRED");

            IntPtr credentialPtr;
            if (!CredRead(target, CredTypeGeneric, 0, out credentialPtr))
                throw new InvalidOperationException("CREDENTIAL_NOT_FOUND");

            byte[] secretBytes = null;
            char[] secretChars = null;
            try
            {
                NativeCredential credential = (NativeCredential)Marshal.PtrToStructure(
                    credentialPtr,
                    typeof(NativeCredential)
                );
                if (!String.Equals(credential.TargetName, target, StringComparison.Ordinal))
                    throw new InvalidOperationException("CREDENTIAL_TARGET_MISMATCH");
                if (credential.CredentialBlob == IntPtr.Zero
                    || credential.CredentialBlobSize == 0
                    || credential.CredentialBlobSize > 8192
                    || credential.CredentialBlobSize % 2 != 0)
                    throw new InvalidOperationException("CREDENTIAL_SECRET_INVALID");

                secretBytes = new byte[credential.CredentialBlobSize];
                Marshal.Copy(credential.CredentialBlob, secretBytes, 0, secretBytes.Length);
                secretChars = Encoding.Unicode.GetChars(secretBytes);
                int usefulLength = secretChars.Length;
                while (usefulLength > 0 && secretChars[usefulLength - 1] == '\0') usefulLength -= 1;
                if (usefulLength == 0) throw new InvalidOperationException("CREDENTIAL_SECRET_INVALID");
                if (usefulLength != secretChars.Length)
                {
                    char[] trimmed = new char[usefulLength];
                    Array.Copy(secretChars, trimmed, usefulLength);
                    Array.Clear(secretChars, 0, secretChars.Length);
                    secretChars = trimmed;
                }

                CredentialMaterial result = new CredentialMaterial(credential.UserName, secretChars);
                secretChars = null;
                return result;
            }
            finally
            {
                if (secretBytes != null) Array.Clear(secretBytes, 0, secretBytes.Length);
                if (secretChars != null) Array.Clear(secretChars, 0, secretChars.Length);
                CredFree(credentialPtr);
            }
        }

        public static CredentialMaterial CreateSyntheticForSelfTest(char[] secret)
        {
            if (secret == null || secret.Length == 0)
                throw new InvalidOperationException("SELF_TEST_CREDENTIAL_INVALID");
            return new CredentialMaterial("__APPLYPACK_SELF_TEST__", secret);
        }
    }

    internal static class WindowsDataProtection
    {
        private const uint CryptProtectUiForbidden = 0x1;

        [StructLayout(LayoutKind.Sequential)]
        private struct DataBlob
        {
            public int Length;
            public IntPtr Data;
        }

        [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CryptProtectData(
            ref DataBlob input,
            string description,
            ref DataBlob optionalEntropy,
            IntPtr reserved,
            IntPtr prompt,
            uint flags,
            out DataBlob output
        );

        [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CryptUnprotectData(
            ref DataBlob input,
            IntPtr description,
            ref DataBlob optionalEntropy,
            IntPtr reserved,
            IntPtr prompt,
            uint flags,
            out DataBlob output
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr LocalFree(IntPtr memory);

        public static byte[] ProtectCurrentUser(byte[] value, byte[] entropy)
        {
            return Transform(value, entropy, true);
        }

        public static byte[] UnprotectCurrentUser(byte[] value, byte[] entropy)
        {
            return Transform(value, entropy, false);
        }

        private static byte[] Transform(byte[] value, byte[] entropy, bool protect)
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                throw new InvalidOperationException("WINDOWS_REQUIRED");
            if (value == null || value.Length == 0)
                throw new InvalidOperationException("DPAPI_INPUT_INVALID");

            DataBlob input = Allocate(value);
            DataBlob optionalEntropy = Allocate(entropy);
            DataBlob output = new DataBlob();
            try
            {
                bool succeeded = protect
                    ? CryptProtectData(
                        ref input,
                        null,
                        ref optionalEntropy,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        CryptProtectUiForbidden,
                        out output
                    )
                    : CryptUnprotectData(
                        ref input,
                        IntPtr.Zero,
                        ref optionalEntropy,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        CryptProtectUiForbidden,
                        out output
                    );
                if (!succeeded || output.Data == IntPtr.Zero || output.Length <= 0)
                    throw new CryptographicException(protect ? "DPAPI_PROTECT_FAILED" : "DPAPI_UNPROTECT_FAILED");

                byte[] result = new byte[output.Length];
                Marshal.Copy(output.Data, result, 0, result.Length);
                return result;
            }
            finally
            {
                ZeroAndFreeHGlobal(input);
                ZeroAndFreeHGlobal(optionalEntropy);
                if (output.Data != IntPtr.Zero)
                {
                    ZeroMemory(output.Data, output.Length);
                    LocalFree(output.Data);
                }
            }
        }

        private static DataBlob Allocate(byte[] value)
        {
            if (value == null || value.Length == 0) return new DataBlob();
            IntPtr pointer = Marshal.AllocHGlobal(value.Length);
            Marshal.Copy(value, 0, pointer, value.Length);
            return new DataBlob { Length = value.Length, Data = pointer };
        }

        private static void ZeroAndFreeHGlobal(DataBlob value)
        {
            if (value.Data == IntPtr.Zero) return;
            ZeroMemory(value.Data, value.Length);
            Marshal.FreeHGlobal(value.Data);
        }

        private static void ZeroMemory(IntPtr pointer, int length)
        {
            for (int index = 0; index < length; index += 1)
                Marshal.WriteByte(pointer, index, 0);
        }
    }

    public sealed class OutputDirectoryGuard : IDisposable
    {
        private const uint FileReadAttributes = 0x80;
        private const uint DeleteAccess = 0x00010000;
        private const uint FileShareRead = 0x1;
        private const uint FileShareWrite = 0x2;
        private const uint FileShareDelete = 0x4;
        private const uint OpenExisting = 3;
        private const uint FileFlagBackupSemantics = 0x02000000;
        private const uint FileFlagOpenReparsePoint = 0x00200000;
        private const uint FileAttributeReparsePoint = 0x400;
        private const uint FileAttributeDirectory = 0x10;
        private const int FileDispositionInfo = 4;

        [StructLayout(LayoutKind.Sequential)]
        private struct ByHandleFileInformation
        {
            public uint FileAttributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
            public uint VolumeSerialNumber;
            public uint FileSizeHigh;
            public uint FileSizeLow;
            public uint NumberOfLinks;
            public uint FileIndexHigh;
            public uint FileIndexLow;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FileDispositionInformation
        {
            [MarshalAs(UnmanagedType.Bool)]
            public bool DeleteFile;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandle(
            SafeFileHandle file,
            out ByHandleFileInformation information
        );

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandle(
            SafeFileHandle file,
            StringBuilder path,
            uint pathLength,
            uint flags
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetFileInformationByHandle(
            SafeFileHandle file,
            int informationClass,
            ref FileDispositionInformation information,
            uint bufferSize
        );

        private SafeFileHandle _directory;
        private readonly uint _volumeSerial;
        private readonly ulong _fileIndex;
        private readonly string _finalPath;

        private OutputDirectoryGuard(SafeFileHandle directory, ByHandleFileInformation information, string finalPath)
        {
            _directory = directory;
            _volumeSerial = information.VolumeSerialNumber;
            _fileIndex = ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
            _finalPath = finalPath;
        }

        public string FinalPath
        {
            get
            {
                ThrowIfDisposed();
                return _finalPath;
            }
        }

        public string IdentityToken
        {
            get
            {
                ThrowIfDisposed();
                return _volumeSerial.ToString("X8") + ":" + _fileIndex.ToString("X16");
            }
        }

        public void AssertIdentity(string expectedIdentityToken, string expectedFinalPath)
        {
            ThrowIfDisposed();
            if (String.IsNullOrWhiteSpace(expectedIdentityToken)
                || String.IsNullOrWhiteSpace(expectedFinalPath)
                || !String.Equals(IdentityToken, expectedIdentityToken, StringComparison.Ordinal)
                || !String.Equals(_finalPath, expectedFinalPath, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("OUTPUT_DIRECTORY_IDENTITY_CHANGED");
            AssertUnchanged();
        }

        public static OutputDirectoryGuard Capture(string directoryPath)
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                throw new InvalidOperationException("WINDOWS_REQUIRED");
            SafeFileHandle handle = OpenDirectory(directoryPath);
            try
            {
                ByHandleFileInformation information = ReadInformation(handle);
                if ((information.FileAttributes & FileAttributeReparsePoint) != 0)
                    throw new InvalidOperationException("OUTPUT_REPARSE_PATH_REJECTED");
                return new OutputDirectoryGuard(handle, information, ReadFinalPath(handle));
            }
            catch
            {
                handle.Dispose();
                throw;
            }
        }

        public void AssertUnchanged()
        {
            ThrowIfDisposed();
            ByHandleFileInformation held = ReadInformation(_directory);
            if (held.VolumeSerialNumber != _volumeSerial || GetFileIndex(held) != _fileIndex)
                throw new InvalidOperationException("OUTPUT_DIRECTORY_IDENTITY_CHANGED");

            SafeFileHandle current = OpenDirectory(_finalPath);
            try
            {
                ByHandleFileInformation information = ReadInformation(current);
                if ((information.FileAttributes & FileAttributeReparsePoint) != 0
                    || information.VolumeSerialNumber != _volumeSerial
                    || GetFileIndex(information) != _fileIndex
                    || !String.Equals(ReadFinalPath(current), _finalPath, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("OUTPUT_DIRECTORY_IDENTITY_CHANGED");
            }
            finally
            {
                current.Dispose();
            }
        }

        public void AssertFileIsDirectChild(SafeFileHandle file, string leafName)
        {
            ThrowIfDisposed();
            if (file == null || file.IsInvalid || file.IsClosed)
                throw new InvalidOperationException("OUTPUT_FILE_HANDLE_INVALID");
            if (String.IsNullOrWhiteSpace(leafName)
                || !String.Equals(Path.GetFileName(leafName), leafName, StringComparison.Ordinal))
                throw new InvalidOperationException("OUTPUT_FILE_NAME_INVALID");
            AssertUnchanged();
            ByHandleFileInformation information = ReadInformation(file);
            if ((information.FileAttributes & FileAttributeReparsePoint) != 0)
                throw new InvalidOperationException("OUTPUT_REPARSE_PATH_REJECTED");
            string expected = Path.Combine(_finalPath, leafName);
            if (!String.Equals(ReadFinalPath(file), expected, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("OUTPUT_FILE_IDENTITY_CHANGED");
        }

        public static void AssertRegularFileHandle(SafeFileHandle file)
        {
            if (file == null || file.IsInvalid || file.IsClosed)
                throw new InvalidOperationException("OUTPUT_FILE_HANDLE_INVALID");
            ByHandleFileInformation information = ReadInformation(file);
            if ((information.FileAttributes & FileAttributeReparsePoint) != 0)
                throw new InvalidOperationException("OUTPUT_REPARSE_PATH_REJECTED");
        }

        public static SafeFileHandle OpenRegularFileForDeletion(string path)
        {
            SafeFileHandle handle = CreateFile(
                path,
                DeleteAccess | FileReadAttributes,
                FileShareRead | FileShareWrite | FileShareDelete,
                IntPtr.Zero,
                OpenExisting,
                FileFlagOpenReparsePoint,
                IntPtr.Zero
            );
            if (handle == null || handle.IsInvalid)
            {
                if (handle != null) handle.Dispose();
                throw new InvalidOperationException("OUTPUT_HANDLE_CLEANUP_FAILED");
            }
            try
            {
                ByHandleFileInformation information = ReadInformation(handle);
                if ((information.FileAttributes & (FileAttributeReparsePoint | FileAttributeDirectory)) != 0)
                    throw new InvalidOperationException("OUTPUT_REPARSE_PATH_REJECTED");
                return handle;
            }
            catch
            {
                handle.Dispose();
                throw;
            }
        }

        public static void MarkDeleteOnClose(SafeFileHandle file)
        {
            if (file == null || file.IsInvalid || file.IsClosed) return;
            FileDispositionInformation information = new FileDispositionInformation { DeleteFile = true };
            if (!SetFileInformationByHandle(
                file,
                FileDispositionInfo,
                ref information,
                (uint)Marshal.SizeOf(typeof(FileDispositionInformation))))
                throw new InvalidOperationException("OUTPUT_HANDLE_CLEANUP_FAILED");
        }

        public void Dispose()
        {
            if (_directory != null)
            {
                _directory.Dispose();
                _directory = null;
            }
        }

        private static SafeFileHandle OpenDirectory(string path)
        {
            SafeFileHandle handle = CreateFile(
                path,
                FileReadAttributes,
                // Deliberately deny delete sharing while the guard is alive. On
                // Windows this prevents the guarded directory from being renamed
                // or deleted between validation, write, flush, and atomic publish.
                FileShareRead | FileShareWrite,
                IntPtr.Zero,
                OpenExisting,
                FileFlagBackupSemantics | FileFlagOpenReparsePoint,
                IntPtr.Zero
            );
            if (handle == null || handle.IsInvalid)
            {
                if (handle != null) handle.Dispose();
                throw new InvalidOperationException("OUTPUT_DIRECTORY_OPEN_FAILED");
            }
            return handle;
        }

        private static ByHandleFileInformation ReadInformation(SafeFileHandle handle)
        {
            ByHandleFileInformation information;
            if (!GetFileInformationByHandle(handle, out information))
                throw new InvalidOperationException("OUTPUT_IDENTITY_QUERY_FAILED");
            return information;
        }

        private static ulong GetFileIndex(ByHandleFileInformation information)
        {
            return ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
        }

        private static string ReadFinalPath(SafeFileHandle handle)
        {
            StringBuilder path = new StringBuilder(1024);
            uint length = GetFinalPathNameByHandle(handle, path, (uint)path.Capacity, 0);
            if (length == 0) throw new InvalidOperationException("OUTPUT_IDENTITY_QUERY_FAILED");
            if (length >= path.Capacity)
            {
                path = new StringBuilder((int)length + 1);
                length = GetFinalPathNameByHandle(handle, path, (uint)path.Capacity, 0);
                if (length == 0 || length >= path.Capacity)
                    throw new InvalidOperationException("OUTPUT_IDENTITY_QUERY_FAILED");
            }
            string value = path.ToString();
            if (value.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
                return @"\\" + value.Substring(8).TrimEnd('\\');
            if (value.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase))
                return value.Substring(4).TrimEnd('\\');
            return value.TrimEnd('\\');
        }

        private void ThrowIfDisposed()
        {
            if (_directory == null || _directory.IsClosed || _directory.IsInvalid)
                throw new ObjectDisposedException("OutputDirectoryGuard");
        }
    }

    public sealed class DeterministicFailingWriteStream : Stream
    {
        private readonly Stream _inner;
        private readonly long _failAfter;
        private long _written;

        public DeterministicFailingWriteStream(Stream inner, long failAfter)
        {
            if (inner == null || !inner.CanWrite || failAfter < 0)
                throw new ArgumentException("SYNTHETIC_OUTPUT_STREAM_INVALID");
            _inner = inner;
            _failAfter = failAfter;
        }

        public override bool CanRead { get { return false; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return true; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override void Flush() { _inner.Flush(); }
        public override int Read(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
        public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count)
        {
            long allowed = _failAfter - _written;
            if (allowed <= 0) throw new IOException("SYNTHETIC_OUTPUT_FAILURE");
            int accepted = (int)Math.Min((long)count, allowed);
            _inner.Write(buffer, offset, accepted);
            _written += accepted;
            if (accepted != count) throw new IOException("SYNTHETIC_OUTPUT_FAILURE");
        }
    }

    public sealed class EnvelopeInfo
    {
        public string MetadataJson { get; internal set; }
        public long CiphertextLength { get; internal set; }
        public long FileLength { get; internal set; }
    }

    public static class StagingBackupEnvelope
    {
        private static readonly byte[] Magic = Encoding.ASCII.GetBytes("APDBSAFE1");
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("ApplyPack/staging-database-safeguard/v1");
        private const int Version = 1;
        private const int IvLength = 16;
        private const int TagLength = 32;
        private const int KeyLength = 64;
        private const int MaximumMetadataLength = 1024 * 1024;
        private const int MaximumProtectedKeyLength = 64 * 1024;

        private sealed class ParsedEnvelope : IDisposable
        {
            public byte[] DataKey;
            public byte[] InitializationVector;
            public string MetadataJson;
            public long HeaderLength;
            public long CiphertextLength;
            public long FileLength;

            public void Dispose()
            {
                if (DataKey != null) Array.Clear(DataKey, 0, DataKey.Length);
                if (InitializationVector != null) Array.Clear(InitializationVector, 0, InitializationVector.Length);
                DataKey = null;
                InitializationVector = null;
                MetadataJson = null;
            }
        }

        private sealed class HmacWriteStream : Stream
        {
            private readonly Stream _destination;
            private readonly HMAC _hmac;

            public HmacWriteStream(Stream destination, HMAC hmac)
            {
                _destination = destination;
                _hmac = hmac;
            }

            public override bool CanRead { get { return false; } }
            public override bool CanSeek { get { return false; } }
            public override bool CanWrite { get { return true; } }
            public override long Length { get { throw new NotSupportedException(); } }
            public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
            public override void Flush() { _destination.Flush(); }
            public override int Read(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
            public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
            public override void SetLength(long value) { throw new NotSupportedException(); }
            public override void Write(byte[] buffer, int offset, int count)
            {
                if (count <= 0) return;
                _hmac.TransformBlock(buffer, offset, count, buffer, offset);
                _destination.Write(buffer, offset, count);
            }
        }

        private sealed class BoundedReadStream : Stream
        {
            private readonly Stream _source;
            private long _remaining;

            public BoundedReadStream(Stream source, long length)
            {
                _source = source;
                _remaining = length;
            }

            public override bool CanRead { get { return true; } }
            public override bool CanSeek { get { return false; } }
            public override bool CanWrite { get { return false; } }
            public override long Length { get { return _remaining; } }
            public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
            public override void Flush() { }
            public override int Read(byte[] buffer, int offset, int count)
            {
                if (_remaining <= 0) return 0;
                int requested = (int)Math.Min((long)count, _remaining);
                int read = _source.Read(buffer, offset, requested);
                if (read <= 0) throw new InvalidDataException("ENVELOPE_TRUNCATED");
                _remaining -= read;
                return read;
            }
            public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
            public override void SetLength(long value) { throw new NotSupportedException(); }
            public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
        }

        public static void Encrypt(Stream plaintext, Stream destination, string metadataJson)
        {
            if (plaintext == null || !plaintext.CanRead) throw new InvalidOperationException("PLAINTEXT_STREAM_INVALID");
            if (destination == null || !destination.CanWrite) throw new InvalidOperationException("ENVELOPE_STREAM_INVALID");
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) throw new InvalidOperationException("WINDOWS_REQUIRED");

            byte[] dataKey = new byte[KeyLength];
            byte[] encryptionKey = new byte[32];
            byte[] macKey = new byte[32];
            byte[] iv = new byte[IvLength];
            byte[] protectedKey = null;
            byte[] metadata = null;
            byte[] header = null;
            try
            {
                using (RandomNumberGenerator random = RandomNumberGenerator.Create())
                {
                    random.GetBytes(dataKey);
                    random.GetBytes(iv);
                }
                Buffer.BlockCopy(dataKey, 0, encryptionKey, 0, encryptionKey.Length);
                Buffer.BlockCopy(dataKey, encryptionKey.Length, macKey, 0, macKey.Length);
                protectedKey = WindowsDataProtection.ProtectCurrentUser(dataKey, Entropy);
                metadata = new UTF8Encoding(false, true).GetBytes(metadataJson ?? "{}");
                if (metadata.Length > MaximumMetadataLength) throw new InvalidOperationException("ENVELOPE_METADATA_TOO_LARGE");

                using (MemoryStream headerStream = new MemoryStream())
                using (BinaryWriter writer = new BinaryWriter(headerStream, Encoding.UTF8, true))
                {
                    writer.Write(Magic);
                    writer.Write(Version);
                    writer.Write(protectedKey.Length);
                    writer.Write(iv.Length);
                    writer.Write(metadata.Length);
                    writer.Write(protectedKey);
                    writer.Write(iv);
                    writer.Write(metadata);
                    writer.Flush();
                    header = headerStream.ToArray();
                }

                destination.Write(header, 0, header.Length);
                using (HMACSHA256 hmac = new HMACSHA256(macKey))
                {
                    hmac.TransformBlock(header, 0, header.Length, header, 0);
                    using (Aes aes = Aes.Create())
                    {
                        aes.KeySize = 256;
                        aes.BlockSize = 128;
                        aes.Mode = CipherMode.CBC;
                        aes.Padding = PaddingMode.PKCS7;
                        aes.Key = encryptionKey;
                        aes.IV = iv;
                        HmacWriteStream authenticatedDestination = new HmacWriteStream(destination, hmac);
                        using (CryptoStream crypto = new CryptoStream(
                            authenticatedDestination,
                            aes.CreateEncryptor(),
                            CryptoStreamMode.Write,
                            true))
                        {
                            plaintext.CopyTo(crypto, 64 * 1024);
                            crypto.FlushFinalBlock();
                        }
                    }
                    hmac.TransformFinalBlock(new byte[0], 0, 0);
                    destination.Write(hmac.Hash, 0, hmac.Hash.Length);
                }
                destination.Flush();
            }
            finally
            {
                Array.Clear(dataKey, 0, dataKey.Length);
                Array.Clear(encryptionKey, 0, encryptionKey.Length);
                Array.Clear(macKey, 0, macKey.Length);
                Array.Clear(iv, 0, iv.Length);
                if (protectedKey != null) Array.Clear(protectedKey, 0, protectedKey.Length);
                if (metadata != null) Array.Clear(metadata, 0, metadata.Length);
                if (header != null) Array.Clear(header, 0, header.Length);
            }
        }

        public static EnvelopeInfo AuthenticateAndReadMetadata(string path)
        {
            using (FileStream input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                return AuthenticateAndReadMetadata(input);
            }
        }

        public static EnvelopeInfo AuthenticateAndReadMetadata(FileStream input)
        {
            if (input == null || !input.CanRead || !input.CanSeek)
                throw new InvalidOperationException("ENVELOPE_STREAM_INVALID");
            using (ParsedEnvelope parsed = Parse(input))
            {
                Authenticate(input, parsed);
                return new EnvelopeInfo
                {
                    MetadataJson = parsed.MetadataJson,
                    CiphertextLength = parsed.CiphertextLength,
                    FileLength = parsed.FileLength
                };
            }
        }

        public static EnvelopeInfo DecryptAuthenticated(string path, Stream destination)
        {
            using (FileStream input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                return DecryptAuthenticated(input, destination);
            }
        }

        public static EnvelopeInfo DecryptAuthenticated(FileStream input, Stream destination)
        {
            if (destination == null || !destination.CanWrite) throw new InvalidOperationException("PLAINTEXT_DESTINATION_INVALID");
            if (input == null || !input.CanRead || !input.CanSeek)
                throw new InvalidOperationException("ENVELOPE_STREAM_INVALID");
            using (ParsedEnvelope parsed = Parse(input))
            {
                // Authenticate and decrypt through one handle. FileShare.Read denies
                // writers and deletion so the verified bytes cannot be swapped
                // between the authentication pass and plaintext streaming.
                Authenticate(input, parsed);
                EnvelopeInfo authenticated = new EnvelopeInfo
                {
                    MetadataJson = parsed.MetadataJson,
                    CiphertextLength = parsed.CiphertextLength,
                    FileLength = parsed.FileLength
                };
                input.Position = parsed.HeaderLength;
                byte[] encryptionKey = new byte[32];
                try
                {
                    Buffer.BlockCopy(parsed.DataKey, 0, encryptionKey, 0, encryptionKey.Length);
                    using (Aes aes = Aes.Create())
                    {
                        aes.KeySize = 256;
                        aes.BlockSize = 128;
                        aes.Mode = CipherMode.CBC;
                        aes.Padding = PaddingMode.PKCS7;
                        aes.Key = encryptionKey;
                        aes.IV = parsed.InitializationVector;
                        using (BoundedReadStream bounded = new BoundedReadStream(input, parsed.CiphertextLength))
                        using (CryptoStream crypto = new CryptoStream(
                            bounded,
                            aes.CreateDecryptor(),
                            CryptoStreamMode.Read,
                            true))
                        {
                            crypto.CopyTo(destination, 64 * 1024);
                        }
                    }
                    destination.Flush();
                    return authenticated;
                }
                finally
                {
                    Array.Clear(encryptionKey, 0, encryptionKey.Length);
                }
            }
        }

        public static Task DrainAsync(Stream source)
        {
            return Task.Run(delegate
            {
                byte[] buffer = new byte[16 * 1024];
                try
                {
                    while (source.Read(buffer, 0, buffer.Length) > 0) { }
                }
                finally
                {
                    Array.Clear(buffer, 0, buffer.Length);
                }
            });
        }

        private static ParsedEnvelope Parse(FileStream input)
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) throw new InvalidOperationException("WINDOWS_REQUIRED");
            if (input.Length < Magic.Length + 16 + IvLength + TagLength + 16)
                throw new InvalidDataException("ENVELOPE_TRUNCATED");
            input.Position = 0;
            using (BinaryReader reader = new BinaryReader(input, Encoding.UTF8, true))
            {
                byte[] magic = reader.ReadBytes(Magic.Length);
                if (!ConstantTimeEquals(magic, Magic)) throw new InvalidDataException("ENVELOPE_FORMAT_INVALID");
                int version = reader.ReadInt32();
                int protectedKeyLength = reader.ReadInt32();
                int ivLength = reader.ReadInt32();
                int metadataLength = reader.ReadInt32();
                if (version != Version
                    || protectedKeyLength <= 0
                    || protectedKeyLength > MaximumProtectedKeyLength
                    || ivLength != IvLength
                    || metadataLength < 0
                    || metadataLength > MaximumMetadataLength)
                    throw new InvalidDataException("ENVELOPE_FORMAT_INVALID");

                byte[] protectedKey = ReadExact(reader, protectedKeyLength);
                byte[] iv = ReadExact(reader, ivLength);
                byte[] metadata = ReadExact(reader, metadataLength);
                byte[] dataKey = null;
                try
                {
                    dataKey = WindowsDataProtection.UnprotectCurrentUser(protectedKey, Entropy);
                    if (dataKey.Length != KeyLength) throw new InvalidDataException("ENVELOPE_KEY_INVALID");
                    long headerLength = input.Position;
                    long ciphertextLength = input.Length - headerLength - TagLength;
                    if (ciphertextLength < 16 || ciphertextLength % 16 != 0)
                        throw new InvalidDataException("ENVELOPE_TRUNCATED");
                    string metadataJson = new UTF8Encoding(false, true).GetString(metadata);
                    ParsedEnvelope result = new ParsedEnvelope
                    {
                        DataKey = dataKey,
                        InitializationVector = iv,
                        MetadataJson = metadataJson,
                        HeaderLength = headerLength,
                        CiphertextLength = ciphertextLength,
                        FileLength = input.Length
                    };
                    dataKey = null;
                    iv = null;
                    return result;
                }
                catch (CryptographicException)
                {
                    throw new InvalidDataException("ENVELOPE_KEY_UNAVAILABLE");
                }
                finally
                {
                    Array.Clear(protectedKey, 0, protectedKey.Length);
                    Array.Clear(metadata, 0, metadata.Length);
                    if (dataKey != null) Array.Clear(dataKey, 0, dataKey.Length);
                    if (iv != null) Array.Clear(iv, 0, iv.Length);
                }
            }
        }

        private static void Authenticate(FileStream input, ParsedEnvelope parsed)
        {
            byte[] macKey = new byte[32];
            byte[] buffer = new byte[64 * 1024];
            byte[] expectedTag = new byte[TagLength];
            try
            {
                Buffer.BlockCopy(parsed.DataKey, 32, macKey, 0, macKey.Length);
                input.Position = 0;
                long remaining = parsed.HeaderLength + parsed.CiphertextLength;
                using (HMACSHA256 hmac = new HMACSHA256(macKey))
                {
                    while (remaining > 0)
                    {
                        int requested = (int)Math.Min((long)buffer.Length, remaining);
                        int read = input.Read(buffer, 0, requested);
                        if (read <= 0) throw new InvalidDataException("ENVELOPE_TRUNCATED");
                        hmac.TransformBlock(buffer, 0, read, buffer, 0);
                        remaining -= read;
                    }
                    hmac.TransformFinalBlock(new byte[0], 0, 0);
                    int tagRead = input.Read(expectedTag, 0, expectedTag.Length);
                    if (tagRead != expectedTag.Length || input.ReadByte() != -1)
                        throw new InvalidDataException("ENVELOPE_TRUNCATED");
                    if (!ConstantTimeEquals(hmac.Hash, expectedTag))
                        throw new InvalidDataException("ENVELOPE_AUTHENTICATION_FAILED");
                }
            }
            finally
            {
                Array.Clear(macKey, 0, macKey.Length);
                Array.Clear(buffer, 0, buffer.Length);
                Array.Clear(expectedTag, 0, expectedTag.Length);
            }
        }

        private static byte[] ReadExact(BinaryReader reader, int length)
        {
            byte[] value = reader.ReadBytes(length);
            if (value.Length != length) throw new InvalidDataException("ENVELOPE_TRUNCATED");
            return value;
        }

        private static bool ConstantTimeEquals(byte[] left, byte[] right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            int difference = 0;
            for (int index = 0; index < left.Length; index += 1)
                difference |= left[index] ^ right[index];
            return difference == 0;
        }
    }
}
