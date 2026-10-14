"""Offline GP77 patch tests: all configuration, filesystem and process data are synthetic."""

import contextlib
import io
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch


SOURCE = Path(__file__).with_name("fix-gp77-redirect.py")
api = SimpleNamespace()
exec(compile(SOURCE.read_text(encoding="utf-8"), str(SOURCE), "exec"), api.__dict__)


MAIN = '''# unrelated main-site configuration, retain byte for byte
server {
    listen 443 ssl;
    server_name fenglou1.com www.fenglou1.com;
    location / { proxy_pass http://127.0.0.1:3000; }
}
'''
HTTP = '''server {
    listen 80;
    server_name gp77.top www.gp77.top;
    if ($host = gp77.top) { return 301 https://$host$request_uri; }
    return 404; # managed by Certbot
}
'''
HTTPS = '''server {
    listen [::]:443 ssl;
    server_name gp77.top www.gp77.top;
    return 301 https://fenglou1.com$request_uri;
}
'''
CONFIG = MAIN + HTTP + HTTPS


class ParserTests(unittest.TestCase):
    def test_quotes_comments_and_escaped_delimiters(self):
        decoration = '''# server { server_name gp77.top; } ignored
map $uri $synthetic {
    default "a;{#}b";
    '~^/literal\\{part\\}$' 'quoted;#{}';
    escaped\\;value escaped\\#value;
    quote "escaped\\\" brace }";
}
'''
        updated, count = api.patch_config(decoration + CONFIG)
        self.assertEqual(count, 2)
        self.assertEqual(updated.replace(api.RULE, ""), decoration + CONFIG)
        self.assertTrue(updated.startswith(decoration + MAIN))

    def test_rule_precedes_server_return_and_certbot_if(self):
        updated, count = api.patch_config(CONFIG)
        self.assertEqual(count, 2)
        self.assertIn("server {" + api.RULE + "\n    listen 80;", updated)
        self.assertIn("server {" + api.RULE + "\n    listen [::]:443 ssl;", updated)
        self.assertLess(updated.index(api.RULE), updated.index("if ($host = gp77.top)"))
        self.assertEqual(updated.replace(api.RULE, ""), CONFIG)

    def test_main_site_blocks_remain_byte_identical(self):
        second = MAIN.replace("fenglou1.com", "fenglou2.com")
        updated, count = api.patch_config(MAIN + HTTP + second + HTTPS + MAIN)
        self.assertEqual(count, 2)
        self.assertEqual(updated.count(MAIN), 2)
        self.assertIn(second, updated)
        self.assertEqual(updated.replace(api.RULE, ""), MAIN + HTTP + second + HTTPS + MAIN)

    def test_only_direct_server_names_select_a_block(self):
        unselected = '''server {
    listen 80;
    server_name not-gp77.top gp77.top.example;
    location / { server_name gp77.top www.gp77.top; }
}
map $host $entry { gp77.top www.gp77.top; }
'''
        updated, count = api.patch_config(unselected + CONFIG)
        self.assertEqual(count, 2)
        self.assertTrue(updated.startswith(unselected + MAIN))
        self.assertEqual(updated.replace(api.RULE, ""), unselected + CONFIG)

    def test_nested_server_names_do_not_satisfy_coverage(self):
        nested = '''server { listen 80; listen 443;
            server_name other.example;
            location / { server_name gp77.top www.gp77.top; }
        }'''
        with self.assertRaises(ValueError):
            api.patch_config(nested)

    def test_mixed_http_block_preserves_other_hosts_and_non_root_rules(self):
        mixed = HTTP.replace("gp77.top www.gp77.top;", "gp77.top www.gp77.top fenglou1.com;")
        updated, count = api.patch_config(mixed + HTTPS)
        self.assertEqual(count, 2)
        self.assertEqual(updated.replace(api.RULE, ""), mixed + HTTPS)
        self.assertIn('set $hulim_gp77_entry "$host:$uri";', api.RULE)
        self.assertIn('if ($hulim_gp77_entry = "gp77.top:/")', api.RULE)
        self.assertIn('if ($hulim_gp77_entry = "www.gp77.top:/")', api.RULE)
        self.assertEqual(api.RULE.count("return 302 " + api.TARGET + ";"), 2)
        self.assertNotIn("fenglou1.com:/", api.RULE)

    def test_each_host_requires_both_ports(self):
        incomplete = [
            HTTP, HTTPS, HTTP + HTTPS.replace("www.gp77.top", "other.example"),
            HTTP.replace("www.gp77.top", "other.example") + HTTPS,
            HTTP.replace("80", "8080") + HTTPS,
            HTTP + HTTPS.replace("[::]:443", "[::]:8443"),
        ]
        for value in incomplete:
            with self.subTest(value=value), self.assertRaises(ValueError):
                api.patch_config(value)

    def test_separate_hosts_and_explicit_addresses_cover_four_pairs(self):
        blocks = "".join(
            "server { listen %s; server_name %s; return 301 https://main.example; }\n" % (address, host)
            for address in ("127.0.0.1:80", "[::]:443") for host in sorted(api.HOSTS)
        )
        updated, count = api.patch_config(blocks)
        self.assertEqual(count, 4)
        self.assertEqual(updated.replace(api.RULE, ""), blocks)

    def test_second_patch_is_rejected(self):
        updated, _ = api.patch_config(CONFIG)
        with self.assertRaisesRegex(ValueError, "already exists"):
            api.patch_config(updated)

    def test_incomplete_syntax_is_rejected(self):
        for suffix in ["}", "server {", 'set $x "unfinished;', "set $x trailing\\", "set $x missing-semicolon }", "set $x ${unsupported};"]:
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                api.patch_config(CONFIG + suffix)


class HeadTests(unittest.TestCase):
    def test_header_probe_ignores_curl_config_and_never_follows_redirects(self):
        with patch.object(api.subprocess, "check_output", return_value="302 " + api.TARGET) as mocked:
            self.assertEqual(api.head("gp77.top", 443, "/"), "302 " + api.TARGET)
        command = mocked.call_args.args[0]
        self.assertEqual(command[:2], ["curl", "--disable"])
        self.assertIn("--no-location", command)
        self.assertIn("--head", command)
        self.assertNotIn("--location", command)
        self.assertNotIn("-L", command)
        self.assertIn("gp77.top:443:127.0.0.1", command)
        self.assertEqual(command[-1], "https://gp77.top/")


class SyntheticSite:
    def __init__(self, content=CONFIG, filename="/etc/nginx/sites-available/synthetic"):
        self.content = content.encode("utf-8")
        self.filename = filename

    def __str__(self):
        return self.filename

    def resolve(self, strict=False):
        return self

    def is_file(self):
        return True

    def read_bytes(self):
        return self.content

    def stat(self):
        return SimpleNamespace(st_mode=0o100640, st_uid=123, st_gid=456)


class ApplyTests(unittest.TestCase):
    def exercise(self, failure=None, deep_failure=False, concurrent=False):
        site = SyntheticSite()
        original = site.content
        backup_root = MagicMock()
        backup = MagicMock()
        writes, commands, requests = [], [], []
        test_count = reload_count = 0

        def run(*command):
            nonlocal test_count, reload_count
            commands.append(command)
            if command == ("nginx", "-t"):
                test_count += 1
                if failure == "initial-test" and test_count == 1 or failure == "updated-test" and test_count == 2:
                    raise subprocess.CalledProcessError(1, command)
            elif command == ("systemctl", "reload", "nginx"):
                reload_count += 1
                if failure == "reload" and reload_count == 1:
                    raise subprocess.CalledProcessError(1, command)
            else:
                self.fail("Unexpected command")

        def head(host, port, request_path):
            requests.append((host, port, request_path))
            self.assertIn(host, api.HOSTS)
            self.assertIn(port, (80, 443))
            if request_path == "/":
                if concurrent:
                    site.content = b"# synthetic concurrent edit"
                return "500 " if failure == "root" or concurrent else "302 " + api.TARGET
            self.assertEqual(request_path, "/fenglou")
            if failure == "preflight-head":
                return "200 "
            return "301 https://main.example/changed" if deep_failure and writes else "301 https://main.example/fenglou"

        def write(target, content, metadata):
            self.assertIs(target, site)
            self.assertEqual(metadata.st_mode, 0o100640)
            writes.append(content)
            site.content = content

        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(api.__dict__, {
                "run": run, "head": head, "atomic_write": write,
                "Path": lambda value: MagicMock(__truediv__=lambda _, child: backup),
            }))
            stack.enter_context(patch.object(api.tempfile, "mkdtemp", return_value="synthetic-backup"))
            stack.enter_context(patch.object(api.time, "sleep"))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            error = None
            try:
                api.apply(site, backup_root)
            except (RuntimeError, ValueError, subprocess.CalledProcessError) as caught:
                error = caught
        return SimpleNamespace(site=site, original=original, backup=backup, writes=writes, commands=commands, requests=requests, error=error)

    def test_success_backs_up_original_and_checks_both_hosts_on_both_ports(self):
        result = self.exercise()
        self.assertIsNone(result.error)
        self.assertEqual(len(result.writes), 1)
        self.assertEqual(result.site.content.decode().replace(api.RULE, ""), CONFIG)
        result.backup.write_bytes.assert_called_once_with(result.original)
        result.backup.chmod.assert_called_once_with(0o600)
        self.assertEqual(result.commands, [("nginx", "-t"), ("nginx", "-t"), ("systemctl", "reload", "nginx")])
        self.assertEqual({(host, port) for host, port, route in result.requests if route == "/"}, {(host, port) for host in api.HOSTS for port in (80, 443)})

    def test_updated_nginx_validation_failure_restores_original(self):
        self.assert_rollback(self.exercise(failure="updated-test"))

    def test_reload_failure_restores_original_and_reloads(self):
        self.assert_rollback(self.exercise(failure="reload"))

    def test_failed_root_verification_restores_original(self):
        self.assert_rollback(self.exercise(failure="root"))

    def test_changed_deep_link_behavior_restores_original(self):
        self.assert_rollback(self.exercise(deep_failure=True))

    def assert_rollback(self, result):
        self.assertIsNotNone(result.error)
        self.assertEqual(len(result.writes), 2)
        self.assertEqual(result.writes[-1], result.original)
        self.assertEqual(result.site.content, result.original)
        self.assertEqual(result.commands[-2:], [("nginx", "-t"), ("systemctl", "reload", "nginx")])

    def test_initial_validation_and_deep_link_failures_never_write(self):
        for failure in ("initial-test", "preflight-head"):
            with self.subTest(failure=failure):
                result = self.exercise(failure=failure)
                self.assertIsNotNone(result.error)
                self.assertEqual(result.writes, [])
                self.assertEqual(result.site.content, result.original)
                result.backup.write_bytes.assert_not_called()

    def test_concurrent_edit_is_never_overwritten_by_rollback(self):
        result = self.exercise(concurrent=True)
        self.assertRegex(str(result.error), "Concurrent config edit")
        self.assertEqual(len(result.writes), 1)
        self.assertEqual(result.site.content, b"# synthetic concurrent edit")

    def test_non_nginx_config_is_rejected_before_process_or_network(self):
        with patch.dict(api.__dict__, {"run": MagicMock(), "head": MagicMock()}):
            with self.assertRaises(ValueError):
                api.apply(SyntheticSite(filename="/etc/nginx-unrelated/synthetic"), MagicMock())
            api.run.assert_not_called()
            api.head.assert_not_called()


if __name__ == "__main__":
    unittest.main()
