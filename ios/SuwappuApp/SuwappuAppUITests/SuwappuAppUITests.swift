//
//  SuwappuAppUITests.swift
//  SuwappuAppUITests
//
//  Created on [Date]
//

import XCTest

final class SuwappuAppUITests: XCTestCase {
    
    var app: XCUIApplication!
    
    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.
        continueAfterFailure = false
        
        app = XCUIApplication()
        app.launch()
    }
    
    override func tearDownWithError() throws {
        app = nil
    }
    
    func testLaunch() throws {
        // UI tests must launch the application that they test.
        let app = XCUIApplication()
        app.launch()
        
        // Use XCTAssert and related functions to verify your tests produce the correct results.
    }
    
    func testAuthScreen_Displays() throws {
        // Given - app launches
        
        // Then
        XCTAssertTrue(app.staticTexts["Suwappu"].exists)
        XCTAssertTrue(app.textFields["Email"].exists)
        XCTAssertTrue(app.secureTextFields["Password"].exists)
    }
    
    func testAuthScreen_LoginButton_DisabledWhenEmpty() throws {
        // Given
        let emailField = app.textFields["Email"]
        let passwordField = app.secureTextFields["Password"]
        let loginButton = app.buttons["Login"]
        
        // When
        emailField.tap()
        emailField.typeText("")
        passwordField.tap()
        passwordField.typeText("")
        
        // Then
        XCTAssertFalse(loginButton.isEnabled)
    }
    
    func testAuthScreen_LoginButton_EnabledWhenFilled() throws {
        // Given
        let emailField = app.textFields["Email"]
        let passwordField = app.secureTextFields["Password"]
        let loginButton = app.buttons["Login"]
        
        // When
        emailField.tap()
        emailField.typeText("test@example.com")
        passwordField.tap()
        passwordField.typeText("password123")
        
        // Then
        XCTAssertTrue(loginButton.isEnabled)
    }
    
    func testAuthScreen_ToggleToRegister() throws {
        // Given
        let toggleButton = app.buttons["Create account"]
        
        // When
        toggleButton.tap()
        
        // Then
        XCTAssertTrue(app.buttons["Register"].exists)
    }
    
    func testTabBar_Navigation() throws {
        // Given - user is logged in (would need to mock this)
        // Note: This test assumes user is authenticated
        
        // When - tap on Swap tab
        app.tabBars.buttons["Swap"].tap()
        
        // Then
        XCTAssertTrue(app.navigationBars["Swap"].exists)
    }
    
    func testSwapScreen_Displays() throws {
        // Given - navigate to swap screen
        app.tabBars.buttons["Swap"].tap()
        
        // Then
        XCTAssertTrue(app.navigationBars["Swap"].exists)
        // Add more assertions based on your UI
    }
    
    func testPerformanceExample() throws {
        if #available(macOS 10.15, iOS 13.0, tvOS 13.0, watchOS 7.0, *) {
            // This measures how long it takes to launch your application.
            measure(metrics: [XCTApplicationLaunchMetric()]) {
                XCUIApplication().launch()
            }
        }
    }
}


