import XCTest
import CryptoKit
@testable import ApprovalCore

// r1275 P5 adapted into a guard; no LAContext or platform signing.
final class ReviewProbes: XCTestCase {
    struct Capture: ApprovalSigner {
        let box: NSMutableString
        func sign(_ b: Data, reason: String) throws -> Data { box.setString(reason); return Data([1]) }
    }
    func make(_ cwd: String, _ command: String) throws -> Data {
        let now = Int(Date().timeIntervalSince1970)
        let v: [String: Any] = ["version": 1, "kind": "enclave", "nonce": String(repeating: "a", count: 32), "issued_at": now, "expires_at": now + 120,
            "cwd": cwd, "command": command, "remote_url": "https://example.invalid/invented/repo", "ref": "[\"refs/heads/main\"]", "operation": "force",
            "git_provider": "/usr/bin/git", "session_id": "s", "operations": [["repo": cwd, "class": "force", "refs": ["HEAD:refs/heads/main"]]],
            "command_sha256": SHA256.hash(data: Data((cwd + "\0" + command).utf8)).map { String(format: "%02x", $0) }.joined()]
        return try JSONSerialization.data(withJSONObject: v, options: [.sortedKeys, .withoutEscapingSlashes])
    }
    func testP5CommandFirstAndDirectoryTruncated() throws {
        let cwd = "/fixture/" + String(repeating: "ok-reviewed-safe-topic-branch-cleanup/", count: 9) + "r"
        let command = "git push --force origin HEAD:refs/heads/main"
        let box = NSMutableString()
        _ = try Approval.approve(try make(cwd, command), signer: Capture(box: box))
        let reason = box as String
        XCTAssertTrue(reason.hasPrefix("What happens: Force-push over branch main"))
        XCTAssertTrue(reason.contains("Operation: force\nCommand: " + command + "\n"))
        XCTAssertTrue(reason.contains("Directory: " + String(cwd.prefix(96)) + "...\nExpires: "))
        XCTAssertFalse(reason.contains(cwd))
        XCTAssertTrue(reason.contains(command))
    }
    func testOversizedCommandRefusesWithoutSigning() throws {
        let box = NSMutableString()
        XCTAssertThrowsError(try Approval.approve(try make("/r", String(repeating: "x", count: 401)), signer: Capture(box: box)))
        XCTAssertEqual(box.length, 0)
    }
}
