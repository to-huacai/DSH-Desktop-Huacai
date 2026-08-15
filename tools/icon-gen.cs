// icon-gen.exe <input.png> <output.ico> [sizes]
// Generates a multi-size ICO (PNG-embedded entries) from a square PNG.
// Compiled against .NET Framework 4.x (csc.exe), C# 5 syntax.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

internal static class IconGen
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("usage: icon-gen <input.png> <output.ico> [sizes]");
                return 2;
            }
            int[] sizes = new int[] { 16, 24, 32, 48, 64, 128, 256 };
            if (args.Length > 2)
            {
                string[] parts = args[2].Split(',');
                sizes = new int[parts.Length];
                for (int i = 0; i < parts.Length; i++) sizes[i] = int.Parse(parts[i].Trim());
            }

            using (Bitmap src = new Bitmap(args[0]))
            using (MemoryStream ms = new MemoryStream())
            {
                byte[][] datas = new byte[sizes.Length][];
                for (int i = 0; i < sizes.Length; i++)
                {
                    int s = sizes[i];
                    using (Bitmap bmp = new Bitmap(s, s, PixelFormat.Format32bppArgb))
                    {
                        using (Graphics g = Graphics.FromImage(bmp))
                        {
                            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            g.SmoothingMode = SmoothingMode.AntiAlias;
                            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                            g.Clear(Color.Transparent);
                            g.DrawImage(src, 0, 0, s, s);
                        }
                        using (MemoryStream png = new MemoryStream())
                        {
                            bmp.Save(png, ImageFormat.Png);
                            datas[i] = png.ToArray();
                        }
                    }
                }

                using (BinaryWriter w = new BinaryWriter(ms))
                {
                    w.Write((short)0);      // reserved
                    w.Write((short)1);      // type: icon
                    w.Write((short)sizes.Length);
                    long offset = 6L + 16L * sizes.Length;
                    for (int i = 0; i < sizes.Length; i++)
                    {
                        int dim = sizes[i] >= 256 ? 0 : sizes[i];
                        w.Write((byte)dim);
                        w.Write((byte)dim);
                        w.Write((byte)0);   // color count
                        w.Write((byte)0);   // reserved
                        w.Write((short)1);  // planes
                        w.Write((short)32); // bpp
                        w.Write((int)datas[i].Length);
                        w.Write((int)offset);
                        offset += datas[i].Length;
                    }
                    for (int i = 0; i < sizes.Length; i++) w.Write(datas[i]);
                }
                File.WriteAllBytes(args[1], ms.ToArray());
            }
            Console.WriteLine("icon written: " + args[1]);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("icon-gen error: " + ex.ToString());
            return 1;
        }
    }
}
