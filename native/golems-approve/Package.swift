// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "golems-approve", platforms: [.macOS(.v13)], products: [.executable(name: "golems-approve", targets: ["golems-approve"])], targets: [.target(name: "ApprovalCore"), .executableTarget(name: "golems-approve", dependencies: ["ApprovalCore"]), .testTarget(name: "ApprovalCoreTests", dependencies: ["ApprovalCore"], resources: [.copy("reason-vectors.json")])])
