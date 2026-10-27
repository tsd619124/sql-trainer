// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SQLLab",
    defaultLocalization: "zh-Hans",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "SQLLabCore", targets: ["SQLLabCore"]),
        .library(name: "SQLLabUI", targets: ["SQLLabUI"])
    ],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .target(name: "SQLLabCore", dependencies: ["CSQLite"], resources: [.process("Resources")]),
        .target(name: "SQLLabUI", dependencies: ["SQLLabCore"]),
        .testTarget(name: "SQLLabCoreTests", dependencies: ["SQLLabCore", "SQLLabUI"])
    ]
)
