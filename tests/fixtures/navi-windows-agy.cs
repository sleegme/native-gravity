using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public class FakeWindowsAgy {
    public static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length > 0 && args[0] == "descendant") {
            Console.WriteLine("READY");
            new ManualResetEvent(false).WaitOne();
            return 0;
        }
        if (args.Length > 0 && args[0] == "models") {
            Console.WriteLine("gemini-4-argon-medium Gemini 4 Argon Medium");
            return 0;
        }
        var json = new JavaScriptSerializer();
        string home = Environment.GetEnvironmentVariable("HOME");
        var info = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "descendant");
        info.UseShellExecute = false;
        info.RedirectStandardOutput = true;
        using (var child = Process.Start(info)) {
            var ready = child.StandardOutput.ReadLineAsync();
            if (!ready.Wait(5000) || ready.Result != "READY") return 9;
            string result = json.Serialize(new {
                home = home,
                profile = Environment.GetEnvironmentVariable("USERPROFILE"),
                update = Environment.GetEnvironmentVariable("AGY_CLI_DISABLE_AUTO_UPDATE"),
                config = File.ReadAllText(Path.Combine(home, ".gemini", "config", "mcp_config.json")),
                descendant = child.Id,
                arguments = args
            });
            var trace = Environment.GetEnvironmentVariable("NTG_FAKE_TRACE");
            if (!String.IsNullOrEmpty(trace)) File.WriteAllText(trace, result);
            var pipeName = Environment.GetEnvironmentVariable("NTG_FAKE_PIPE");
            if (!String.IsNullOrEmpty(pipeName)) {
                using (var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.Out)) {
                    pipe.Connect(5000);
                    using (var writer = new StreamWriter(pipe)) writer.WriteLine(result);
                }
            }
            var mode = Environment.GetEnvironmentVariable("NTG_FAKE_MODE");
            if (mode == "block") new ManualResetEvent(false).WaitOne();
            if (mode == "overflow") {
                Console.Write(new string('x', 24 * 1024 * 1024));
                Console.Out.Flush();
                new ManualResetEvent(false).WaitOne();
            }
            if (mode == "error") {
                Console.Error.WriteLine(home + " SYNTHETIC_PRIVATE_ERROR");
                return 7;
            }
            Console.Error.Write("fixture-progress-without-newline");
            Console.WriteLine(json.Serialize(new { status = "SUCCESS", response = result }));
            return 0;
        }
    }
}
