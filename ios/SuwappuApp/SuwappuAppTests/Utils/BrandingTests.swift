//
//  BrandingTests.swift
//  SuwappuAppTests
//
//  Created on [Date]
//

import XCTest
import SwiftUI
@testable import SuwappuApp

final class BrandingTests: XCTestCase {
    
    func testBrandColors_Exist() {
        // Then
        XCTAssertNotNil(BrandColors.accent)
        XCTAssertNotNil(BrandColors.background)
        XCTAssertNotNil(BrandColors.secondaryBackground)
        XCTAssertNotNil(BrandColors.textPrimary)
        XCTAssertNotNil(BrandColors.textSecondary)
    }
    
    func testSpacing_Values() {
        // Then
        XCTAssertEqual(Spacing.xs, 4)
        XCTAssertEqual(Spacing.sm, 8)
        XCTAssertEqual(Spacing.md, 16)
        XCTAssertEqual(Spacing.lg, 24)
        XCTAssertEqual(Spacing.xl, 32)
        XCTAssertEqual(Spacing.xxl, 48)
    }
    
    func testBrandTypography_Exists() {
        // Then
        XCTAssertNotNil(BrandTypography.largeTitle)
        XCTAssertNotNil(BrandTypography.title)
        XCTAssertNotNil(BrandTypography.headline)
        XCTAssertNotNil(BrandTypography.body)
        XCTAssertNotNil(BrandTypography.caption)
        XCTAssertNotNil(BrandTypography.small)
    }
}


