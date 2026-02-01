# Suwappu Performance Scaling Roadmap 🚀

This document outlines how to transition from the current "Free Tier" setup to a high-performance architecture capable of handling thousands of concurrent users and millisecond-latency swaps.

## 1. Compute: The C++ Core Integration ⚡
The project is already designed with a C++ fallback. To scale:
- **Offload Heavy Math**: Move token price calculations, route optimization, and transaction signing to the `suwappu_core` C++ extension.
- **Multithreading**: Use C++ `std::thread` or `tbb` for parallel price polling across multiple chains, bypassing the Python GIL.

## 2. Horizontal Scaling: Distributed Workers 🏗️
Currently, the bot runs as a single background process. 
- **Task De-coupling**: Split the `bot.main` into separate specialized workers:
    - **Poller Worker**: Only watches the blockchain (High I/O).
    - **Execution Worker**: Only handles trade signing and submission (High security).
    - **Notification Worker**: Handles Telegram/WhatsApp messaging (High latency).
- **Orchestration**: Use **Redis** or **RabbitMQ** as a task queue (Celery) to distribute these tasks across multiple Render "Background Workers."

## 3. Caching: Redis Cluster 🧠
You recently switched to in-memory caching for the free plan. To scale:
- **Redis Cluster**: Move back to a managed Redis instance. This allows multiple API and Bot instances to share the same state (e.g., token prices, user sessions).
- **Write-Behind Caching**: Cache database writes in Redis and sync to Postgres asynchronously to reduce DB lock contention.

## 4. Database Optimization 🗄️
- **Read Replicas**: Use a primary DB for transactions and read replicas for the Dashboard API.
- **Connection Pooling**: Use `PgBouncer` to handle thousands of concurrent database connections from multiple worker nodes.

## 5. Webhook Throughput 📲
Incoming messages from WhatsApp/Telegram can spike.
- **Queue-First Architecture**: Instead of processing the message inside the FastAPI endpoint, push the raw payload into a Redis stream and return `200 OK` immediately.
- **Async Processing**: Have a dedicated fleet of "Message Workers" consume the stream. This prevents Meta/Telegram from timing out while your bot calculates a complex swap quote.

## 6. Infrastructure Layout (Render Tiering) 🌐
| Tier | Architecture | Services |
| :--- | :--- | :--- |
| **Free (Current)** | Monolithic | 1 Web, 1 Worker, 1 DB, In-memory Cache |
| **Silver** | Separated | 2 Web (Load Balanced), 3 Specialized Workers, Managed Redis |
| **Gold (High Perf)** | High-Availability | Autoscaling Web, K8s Worker Cluster, DB Cluster, Global Redis |

## 7. Next Immediate Steps
1. **Enable Redis**: When traffic grows, uncomment the Redis section in `render.yaml`.
2. **Profile with `/perf`**: Use the built-in admin performance command to identify the slowest DB queries and functions.
3. **Build C++ Core**: Run `pip install -e .` in a high-memory environment to compile the performance extensions.
