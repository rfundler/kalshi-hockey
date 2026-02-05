import SwiftUI

struct GameListView: View {
    @StateObject private var viewModel = GameViewModel()
    @State private var showingAddGame = false
    @State private var navigationPath = NavigationPath()

    var body: some View {
        NavigationStack(path: $navigationPath) {
            Group {
                if viewModel.isLoading && viewModel.games.isEmpty {
                    ProgressView("Loading games...")
                } else if viewModel.games.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "sportscourt")
                            .font(.system(size: 60))
                            .foregroundColor(.gray)
                        Text("No games configured")
                            .font(.headline)
                        Text("Tap + to add a game")
                            .foregroundColor(.secondary)
                    }
                } else {
                    List {
                        ForEach(viewModel.games) { gameWithPrices in
                            NavigationLink(value: gameWithPrices) {
                                GameRowView(game: gameWithPrices)
                            }
                        }
                        .onDelete { indexSet in
                            for index in indexSet {
                                let game = viewModel.games[index]
                                Task {
                                    await viewModel.deleteGame(id: game.id)
                                }
                            }
                        }
                    }
                    .refreshable {
                        await viewModel.loadGames()
                    }
                }
            }
            .navigationTitle("Games")
            .navigationDestination(for: GameWithPrices.self) { game in
                QuickTradeView(game: game, viewModel: viewModel)
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingAddGame = true }) {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddGame) {
                GameSetupView(viewModel: viewModel, isPresented: $showingAddGame) { createdGameId in
                    // Navigate to the newly created game
                    if let game = viewModel.games.first(where: { $0.id == createdGameId }) {
                        navigationPath.append(game)
                    }
                }
            }
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK") { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
        }
        .task {
            await viewModel.loadGames()
        }
        .onAppear {
            viewModel.startAutoRefresh()
        }
        .onDisappear {
            viewModel.stopAutoRefresh()
        }
    }
}

struct GameRowView: View {
    let game: GameWithPrices

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(game.game.name)
                .font(.headline)

            HStack {
                VStack(alignment: .leading) {
                    Text(game.game.sideA.teamName)
                        .font(.subheadline)
                    if let ask = game.sideAAsk {
                        Text("\(Int(ask))¢")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                Text("vs")
                    .foregroundColor(.secondary)

                Spacer()

                VStack(alignment: .trailing) {
                    Text(game.game.sideB.teamName)
                        .font(.subheadline)
                    if let ask = game.sideBAsk {
                        Text("\(Int(ask))¢")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}
