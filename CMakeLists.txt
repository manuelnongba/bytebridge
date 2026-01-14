cmake_minimum_required(VERSION 3.20)
project(ByteBridge VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# Set Qt6 path for Homebrew on macOS
if(APPLE)
    set(CMAKE_PREFIX_PATH "/opt/homebrew/opt/qt@6" ${CMAKE_PREFIX_PATH})
endif()

# Find Qt6 packages
find_package(Qt6 REQUIRED COMPONENTS 
    Core 
    Gui 
    Widgets 
    WebSockets
    Network
    Concurrent
)

# Find QScintilla
find_package(QScintilla QUIET)
if(NOT QScintilla_FOUND)
    # Fallback: try to find it manually
    find_library(QSCINTILLA_LIBRARY 
        NAMES qscintilla2_qt6 qscintilla2-qt6 qscintilla2
        HINTS /usr/lib /usr/local/lib /opt/homebrew/lib
    )
    find_path(QSCINTILLA_INCLUDE_DIR 
        NAMES Qsci/qsciscintilla.h
        HINTS /usr/include /usr/local/include /opt/homebrew/include
    )
    if(QSCINTILLA_LIBRARY AND QSCINTILLA_INCLUDE_DIR)
        set(QSCINTILLA_FOUND TRUE)
        message(STATUS "Found QScintilla: ${QSCINTILLA_LIBRARY}")
    endif()
endif()

# Source files
set(SOURCES
    src/main.cpp
    src/app/Application.cpp
    src/ui/MainWindow.cpp
    src/ui/NameDialog.cpp
    src/editor/CodeEditor.cpp
    src/collaboration/WebSocketClient.cpp
    src/collaboration/CRDTDocument.cpp
    src/collaboration/Presence.cpp
    src/ai/AIBridger.cpp
    src/utils/DeepLink.cpp
    src/utils/Clipboard.cpp
)

# Header files
set(HEADERS
    src/app/Application.h
    src/ui/MainWindow.h
    src/ui/NameDialog.h
    src/editor/CodeEditor.h
    src/collaboration/WebSocketClient.h
    src/collaboration/CRDTDocument.h
    src/collaboration/Presence.h
    src/ai/AIBridger.h
    src/utils/DeepLink.h
    src/utils/Clipboard.h
)

# Resources
set(RESOURCES
    resources/resources.qrc
)

# Create executable
if(APPLE)
    set(MACOSX_BUNDLE_ICON_FILE AppIcon.icns)
    set(APP_ICON_MACOS "${CMAKE_SOURCE_DIR}/resources/icons/AppIcon.icns")
    set_source_files_properties(${APP_ICON_MACOS} PROPERTIES MACOSX_PACKAGE_LOCATION "Resources")
    
    add_executable(${PROJECT_NAME} MACOSX_BUNDLE
        ${SOURCES}
        ${HEADERS}
        ${RESOURCES}
        ${APP_ICON_MACOS}
    )
    
    set_target_properties(${PROJECT_NAME} PROPERTIES
        MACOSX_BUNDLE TRUE
        MACOSX_BUNDLE_GUI_IDENTIFIER "com.bytebridge.app"
        MACOSX_BUNDLE_BUNDLE_VERSION ${PROJECT_VERSION}
        MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION_MAJOR}.${PROJECT_VERSION_MINOR}
        MACOSX_BUNDLE_INFO_PLIST "${CMAKE_SOURCE_DIR}/resources/Info.plist.in"
    )
elseif(WIN32)
    add_executable(${PROJECT_NAME} WIN32
        ${SOURCES}
        ${HEADERS}
        ${RESOURCES}
    )
else()
    add_executable(${PROJECT_NAME}
        ${SOURCES}
        ${HEADERS}
        ${RESOURCES}
    )
endif()

# Include directories
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${QSCINTILLA_INCLUDE_DIR}
)

# Link libraries
target_link_libraries(${PROJECT_NAME} PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::WebSockets
    Qt6::Network
    Qt6::Concurrent
    ${QSCINTILLA_LIBRARY}
)

# Install rules
install(TARGETS ${PROJECT_NAME}
    BUNDLE DESTINATION .
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)

# Copy Qt dependencies on Windows
if(WIN32)
    add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:Qt6::Core>
            $<TARGET_FILE:Qt6::Gui>
            $<TARGET_FILE:Qt6::Widgets>
            $<TARGET_FILE:Qt6::WebSockets>
            $<TARGET_FILE:Qt6::Network>
            $<TARGET_FILE_DIR:${PROJECT_NAME}>
    )
endif()
