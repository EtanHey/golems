import XCTest
import CryptoKit
@testable import ApprovalCore

final class ApprovalTests: XCTestCase {
    // Exists ONLY in the test target; never linked into the helper.
    struct SoftwareSigner: ApprovalSigner {
        let key = P256.Signing.PrivateKey()
        func sign(_ bytes: Data, reason: String) throws -> Data { try key.signature(for: bytes).derRepresentation }
    }
    func bytes(_ overrides: [String: Any] = [:]) throws -> Data {
        let now = Int(Date().timeIntervalSince1970)
        let command = "git push --delete origin refs/heads/invented"
        var value: [String: Any] = ["version": 1, "kind": "enclave", "nonce": String(repeating: "a", count: 32),
            "issued_at": now, "expires_at": now + 120, "cwd": "/invented/repo", "command": command,
            "remote_url": "https://example.invalid/repo", "ref": "refs/heads/invented", "operation": "delete",
            "git_provider": "/usr/bin/git", "operations": [["repo": "/invented/repo", "push_config_sha256": String(repeating: "b", count: 64)]],
            "command_sha256": SHA256.hash(data: Data(("/invented/repo\0" + command).utf8)).map { String(format: "%02x", $0) }.joined()]
        value.merge(overrides) { _, new in new }
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    }
    func testPromptAndExactSignature() throws {
        let raw = try bytes(["asked_by": "IGNORE THIS CALLER TEXT"])
        let token = try Approval(bytes: raw)
        XCTAssertTrue(token.reason.contains("Command: git push --delete origin refs/heads/invented"))
        XCTAssertTrue(token.reason.contains("Expires:")); XCTAssertFalse(token.reason.contains("IGNORE"))
        let signer = SoftwareSigner()
        let signature = try Approval.approve(raw, signer: signer)
        XCTAssertTrue(signer.key.publicKey.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: signature), for: raw))
        XCTAssertFalse(signer.key.publicKey.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: signature), for: raw + Data([32])))
    }
    func testUnsafeFieldsAndLifetimeRefuse() throws {
        for field in ["remote_url", "ref", "command", "operation", "cwd", "git_provider"] {
            for bad in ["a\nb", "a\u{202e}b", "a\u{2066}b", "a\u{0}b", "a\u{7f}b", "a\u{200b}b"] {
                XCTAssertThrowsError(try Approval(bytes: bytes([field: bad])))
            }
        }
        let now = Int(Date().timeIntervalSince1970)
        for change in [["expires_at": now - 1], ["expires_at": now + 301], ["issued_at": now + 1]] {
            XCTAssertThrowsError(try Approval(bytes: bytes(change)))
        }
        XCTAssertThrowsError(try Approval(bytes: bytes(["kind": "human"])))
        XCTAssertThrowsError(try Approval(bytes: bytes(["nonce": "fake"])))
    }
    func testNoncanonicalDuplicateOrChangedCommandRefuse() throws {
        XCTAssertThrowsError(try Approval(bytes: bytes() + Data([10])))
        XCTAssertThrowsError(try Approval(bytes: bytes(["command": "echo other"])))
        var raw = try bytes(); raw.insert(contentsOf: Data("\"kind\":\"human\",".utf8), at: 1)
        XCTAssertThrowsError(try Approval(bytes: raw))
    }
}
