import SwiftUI

@main
struct KalshiTraderApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
        TabView {
            GameListView()
                .tabItem {
                    Label("Games", systemImage: "sportscourt")
                }

            PositionsView()
                .tabItem {
                    Label("Positions", systemImage: "chart.bar")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
    }
}
