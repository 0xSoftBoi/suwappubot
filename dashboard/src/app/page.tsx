"use client";

import React, { useState, useEffect } from "react";
import {
    Wallet,
    ArrowUpRight,
    ArrowDownLeft,
    History,
    Settings,
    LayoutDashboard,
    BarChart3,
    TrendingUp,
    RefreshCcw,
    Plus
} from "lucide-react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area
} from "recharts";

const data = [
    { name: "Mon", value: 4000 },
    { name: "Tue", value: 3000 },
    { name: "Wed", value: 5000 },
    { name: "Thu", value: 4500 },
    { name: "Fri", value: 6000 },
    { name: "Sat", value: 5500 },
    { name: "Sun", value: 7000 },
];

export default function Dashboard() {
    const [activeTab, setActiveTab] = useState("overview");
    const [portfolio, setPortfolio] = useState<any>(null);
    const [swaps, setSwaps] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchData() {
            try {
                const [pRes, sRes] = await Promise.all([
                    fetch("/api/portfolio"),
                    fetch("/api/swaps?limit=5")
                ]);
                setPortfolio(await pRes.json());
                setSwaps(await sRes.json());
            } catch (err) {
                console.error("Failed to fetch dashboard data:", err);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    return (
        <div className="flex h-screen overflow-hidden">
            {/* Sidebar */}
            <aside className="w-64 glass border-r border-white/5 flex flex-col">
                <div className="p-6 flex items-center gap-3">
                    <div className="w-10 h-10 accent-gradient rounded-xl flex items-center justify-center font-bold text-white text-xl">
                        S
                    </div>
                    <span className="text-xl font-bold tracking-tight">Suwappu</span>
                </div>

                <nav className="flex-1 px-4 py-4 space-y-2">
                    <SidebarItem icon={<LayoutDashboard size={20} />} label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
                    <SidebarItem icon={<Wallet size={20} />} label="Portfolio" active={activeTab === "portfolio"} onClick={() => setActiveTab("portfolio")} />
                    <SidebarItem icon={<RefreshCcw size={20} />} label="Swaps" active={activeTab === "swaps"} onClick={() => setActiveTab("swaps")} />
                    <SidebarItem icon={<History size={20} />} label="History" active={activeTab === "history"} onClick={() => setActiveTab("history")} />
                    <SidebarItem icon={<BarChart3 size={20} />} label="Analytics" active={activeTab === "analytics"} onClick={() => setActiveTab("analytics")} />
                </nav>

                <div className="p-4 border-t border-white/5 space-y-2">
                    <SidebarItem icon={<Settings size={20} />} label="Settings" onClick={() => { }} />
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto p-8">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
                        <p className="text-gray-400">Welcome back, Captain. Here's your fleet's status.</p>
                    </div>
                    <div className="flex gap-4">
                        <div className="px-4 py-2 bg-white/5 rounded-lg border border-white/10 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-sm font-medium">API Online</span>
                        </div>
                        <button className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-all">
                            <Plus size={20} /> New Swap
                        </button>
                    </div>
                </header>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <StatCard
                        title="Total Balance"
                        value={loading ? "Loading..." : `$${portfolio?.totalUSD?.toLocaleString() || "0.00"}`}
                        change={loading ? "..." : "+12.5%"}
                        icon={<Wallet className="text-blue-400" />}
                    />
                    <StatCard title="24h Volume" value="$42,120.50" change="+5.2%" icon={<TrendingUp className="text-green-400" />} />
                    <StatCard title="Active Orders" value="12" change="Stable" icon={<BarChart3 className="text-purple-400" />} />
                    <StatCard title="Gas Saved" value="$1,240.20" change="+8.1%" icon={<RefreshCcw className="text-orange-400" />} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Chart */}
                    <div className="lg:col-span-2 glass rounded-2xl p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold">Performance</h2>
                            <select className="bg-transparent border border-white/10 rounded-lg px-2 py-1 text-sm outline-none">
                                <option>Last 7 days</option>
                                <option>Last 30 days</option>
                            </select>
                        </div>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data}>
                                    <defs>
                                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <Tooltip
                                        contentStyle={{ backgroundColor: "#1A1D26", border: "none", borderRadius: "8px" }}
                                        itemStyle={{ color: "#F8F9FA" }}
                                    />
                                    <Area type="monotone" dataKey="value" stroke="#3B82F6" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Recent Activity */}
                    <div className="glass rounded-2xl p-6">
                        <h2 className="text-xl font-bold mb-6">Recent Swaps</h2>
                        <div className="space-y-4">
                            {loading ? (
                                <p className="text-gray-500 text-sm">Loading activity...</p>
                            ) : swaps.length > 0 ? (
                                swaps.map((swap: any) => (
                                    <ActivityItem
                                        key={swap.id}
                                        from={swap.fromToken}
                                        to={swap.toToken}
                                        amount={swap.fromAmount + " " + swap.fromToken}
                                        status={swap.status}
                                    />
                                ))
                            ) : (
                                <>
                                    <ActivityItem from="USDC" to="ETH" amount="$1,200" status="Completed" />
                                    <ActivityItem from="SOL" to="USDT" amount="$450" status="Completed" />
                                    <ActivityItem from="DAI" to="MATIC" amount="$2,100" status="Executing" />
                                </>
                            )}
                        </div>
                        <button className="w-full mt-6 text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors">
                            View all history →
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
}

function SidebarItem({ icon, label, active = false, onClick }: any) {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active
                ? "bg-blue-600/10 text-blue-400 border border-blue-600/20"
                : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
        >
            {icon}
            <span className="font-medium">{label}</span>
        </button>
    );
}

function StatCard({ title, value, change, icon }: any) {
    return (
        <div className="glass rounded-2xl p-6 card-hover border border-white/5">
            <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-white/5 rounded-lg">{icon}</div>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${change.startsWith("+") ? "bg-green-500/10 text-green-400" : "bg-gray-500/10 text-gray-400"
                    }`}>
                    {change}
                </span>
            </div>
            <h3 className="text-gray-400 text-sm mb-1">{title}</h3>
            <p className="text-2xl font-bold">{value}</p>
        </div>
    );
}

function ActivityItem({ from, to, amount, status }: any) {
    return (
        <div className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">
            <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-[10px] border-2 border-[#1A1D26]">{from}</div>
                    <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-[10px] border-2 border-[#1A1D26]">{to}</div>
                </div>
                <div>
                    <p className="text-sm font-medium">{from} → {to}</p>
                    <p className="text-xs text-gray-500">{status}</p>
                </div>
            </div>
            <p className="text-sm font-bold">{amount}</p>
        </div>
    );
}
