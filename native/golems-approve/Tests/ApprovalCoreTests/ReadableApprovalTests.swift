import XCTest
import CryptoKit
@testable import ApprovalCore

final class ReadableApprovalTests: XCTestCase {
    func bytes(_ kind: String = "delete", reason: Any? = nil, refs: [String] = ["refs/heads/topic"]) throws -> Data {
        let now = Int(Date().timeIntervalSince1970)
        let command = "git push --delete origin refs/heads/topic"
        var op: [String: Any] = ["repo": "/invented", "class": kind, "refs": refs]
        if kind == "lease" { op["ref"] = "refs/heads/topic" }
        if kind == "settings" { op["target"] = "repos/invented/repo/rulesets/1" }
        var token: [String: Any] = ["version": 1, "kind": "enclave", "nonce": String(repeating: "a", count: 32),
            "issued_at": now, "expires_at": now + 120, "cwd": "/invented", "command": command,
            "remote_url": "https://github.com/invented/repo.git", "ref": "refs/heads/topic", "operation": kind,
            "git_provider": "/usr/bin/git", "operations": [op],
            "command_sha256": SHA256.hash(data: Data(("/invented\0" + command).utf8)).map { String(format: "%02x", $0) }.joined()]
        if let reason { token["reason"] = reason }
        return try JSONSerialization.data(withJSONObject: token, options: [.sortedKeys, .withoutEscapingSlashes])
    }
    func testSharedReasonVectors() throws {
        struct Vector: Decodable { let name: String, text: String, allowed: Bool }
        let path = Bundle.module.url(forResource: "reason-vectors", withExtension: "json")!
        let vectors = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: path))
        for v in vectors {
            if v.allowed { XCTAssertNoThrow(try Approval(bytes: bytes(reason: v.text)), v.name) }
            else { XCTAssertThrowsError(try Approval(bytes: bytes(reason: v.text)), v.name) }
        }
    }
    func testExactOrderAndUntrustedLabel() throws {
        let raw = try bytes(reason: "Preserve the approved backup.")
        let token = try Approval(bytes: raw)
        let lines = token.reason.components(separatedBy: "\n")
        XCTAssertEqual(lines.count, 6)
        XCTAssertEqual(lines[0], "What happens: Delete branch topic from GitHub repo invented/repo. This cannot be undone.")
        XCTAssertEqual(lines[1], "Why (the agent's words, not checked): Preserve the approved backup.")
        XCTAssertEqual(lines[2], "Operation: delete")
        XCTAssertEqual(lines[3], "Command: git push --delete origin refs/heads/topic")
        XCTAssertEqual(lines[4], "Directory: /invented")
        XCTAssertTrue(lines[5].hasPrefix("Expires: "))
        XCTAssertFalse(try Approval(bytes: bytes()).reason.contains("Why ("))
    }
    func testBadReasonsAndUnknownShapesRefuse() throws {
        for bad in ["a\nb", "\t", "\u{0}", "\u{202e}", "\u{200b}", "\u{feff}", "\u{115f}", "\u{034f}", "\u{2060}", String(repeating: "x", count: 201)] {
            XCTAssertThrowsError(try Approval(bytes: bytes(reason: bad)))
        }
        XCTAssertThrowsError(try Approval(bytes: bytes(reason: 17)))
        XCTAssertThrowsError(try Approval(bytes: bytes("unknown")))
        XCTAssertThrowsError(try Approval(bytes: bytes(refs: ["*"])))
    }
    func testLocalRewriteWording() throws {
        let token = try Approval(bytes: bytes("rewrite"))
        XCTAssertEqual(token.whatHappens, "Rewrite local history on branch topic in GitHub repo invented/repo.")
    }
    func testEveryClassAndReasonCannotChangeNarrative() throws {
        for kind in ["delete", "force", "lease", "rewrite", "settings"] {
            let a = try Approval(bytes: bytes(kind, reason: "First explanation"))
            let b = try Approval(bytes: bytes(kind, reason: "Different explanation"))
            XCTAssertEqual(a.reason.components(separatedBy: "\n")[0], b.reason.components(separatedBy: "\n")[0])
            XCTAssertTrue(a.reason.contains("invented/repo"))
            XCTAssertNotEqual(try bytes(kind, reason: "First explanation"), try bytes(kind, reason: "Different explanation"))
        }
    }
}
