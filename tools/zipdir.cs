// zipdir.exe — minimal zip builder with console progress.
//   zipdir.exe dir <dir> <out.zip>              recursive directory archive
//   zipdir.exe files <out.zip> <file> [file...] files at archive root
// Compiled against .NET Framework 4.x (csc.exe), C# 5 syntax.
using System;
using System.IO;
using System.IO.Compression;

internal static class ZipDir
{
    private static int AddEntry(ZipArchive archive, string diskPath, string entryName)
    {
        using (FileStream src = new FileStream(diskPath, FileMode.Open, FileAccess.Read))
        {
            ZipArchiveEntry entry = archive.CreateEntry(entryName, CompressionLevel.Optimal);
            using (Stream dst = entry.Open())
            {
                byte[] buf = new byte[262144];
                int read;
                while ((read = src.Read(buf, 0, buf.Length)) > 0)
                {
                    dst.Write(buf, 0, read);
                }
            }
        }
        return 1;
    }

    private static int Walk( ZipArchive archive, string dir, string baseDir, ref int count, ref long total)
    {
        foreach (string entry in Directory.GetFileSystemEntries(dir))
        {
            string name = Path.GetFileName(entry);
            if (Directory.Exists(entry))
            {
                Walk(archive, entry, baseDir, ref count, ref total);
            }
            else
            {
                string rel = entry.Substring(baseDir.Length).TrimStart('\\', '/').Replace('\\', '/');
                count += AddEntry(archive, entry, rel);
                total += new FileInfo(entry).Length;
                if (count % 500 == 0)
                {
                    Console.WriteLine("zip: " + count + " files, " + (total / 1048576) + " MB");
                }
            }
        }
        return 0;
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 3)
            {
                Console.Error.WriteLine("usage: zipdir dir <dir> <out.zip>  |  zipdir files <out.zip> <file...>");
                return 2;
            }
            string mode = args[0];
            string outZip;
            int fileStart;
            if (mode == "dir")
            {
                outZip = args[2];
                fileStart = -1;
            }
            else if (mode == "files")
            {
                outZip = args[1];
                fileStart = 2;
            }
            else
            {
                Console.Error.WriteLine("unknown mode: " + mode);
                return 2;
            }

            int count = 0;
            long total = 0;
            using (FileStream fs = new FileStream(outZip, FileMode.Create, FileAccess.Write))
            using (ZipArchive archive = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                if (mode == "dir")
                {
                    string dir = args[1];
                    string baseDir = dir.TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
                    Walk(archive, dir, baseDir, ref count, ref total);
                }
                else
                {
                    for (int i = fileStart; i < args.Length; i++)
                    {
                        string file = args[i];
                        count += AddEntry(archive, file, Path.GetFileName(file));
                        total += new FileInfo(file).Length;
                    }
                }
            }
            Console.WriteLine("zip done: " + outZip + " (" + count + " files, " + (total / 1048576) + " MB)");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("zipdir error: " + ex.ToString());
            return 1;
        }
    }
}
