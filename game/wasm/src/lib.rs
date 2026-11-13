use wasm_bindgen::prelude::*;

#[wasm_bindgen(inline_js = "export const distance = (x, y, z) => Math.hypot(x, y, z);")]
extern "C" {
    fn distance(x: f64, y: f64, z: f64) -> f64;
}

#[wasm_bindgen]
pub fn probe() -> u32 {
    6 * 7
}

// The localhost worker uses this to exercise recovery from a real WASM trap.
#[wasm_bindgen]
pub fn trap_search() {
    core::arch::wasm32::unreachable();
}

#[wasm_bindgen]
pub struct Router {
    start: Vec<i32>,
    to: Vec<i32>,
    cost: Vec<f32>,
    kind: Vec<u8>,
    edge_server: Vec<i32>,
    node_server: Vec<i32>,
    gate_dir: Vec<i8>,
    x: Vec<f32>,
    y: Vec<f32>,
    z: Vec<f32>,
    walk_speed: f64,
    stair_penalty: f64,
    escalator: u8,
    stair: u8,
    lift: u8,
    scores: Vec<f64>,
    parent: Vec<usize>,
    seen: Vec<u32>,
    epoch: u32,
    heap: Vec<(usize, f64)>,
    route: Vec<i32>,
}

#[wasm_bindgen]
impl Router {
    #[wasm_bindgen(constructor)]
    pub fn new(
        start: Vec<i32>,
        to: Vec<i32>,
        cost: Vec<f32>,
        kind: Vec<u8>,
        edge_server: Vec<i32>,
        node_server: Vec<i32>,
        gate_dir: Vec<i8>,
        x: Vec<f32>,
        y: Vec<f32>,
        z: Vec<f32>,
        walk_speed: f64,
        stair_penalty: f64,
        escalator: u8,
        stair: u8,
        lift: u8,
    ) -> Self {
        let count = x.len();
        Self {
            start,
            to,
            cost,
            kind,
            edge_server,
            node_server,
            gate_dir,
            x,
            y,
            z,
            walk_speed,
            stair_penalty,
            escalator,
            stair,
            lift,
            scores: vec![0.; count],
            parent: vec![0; count],
            seen: vec![0; count],
            epoch: 0,
            heap: Vec::new(),
            route: Vec::new(),
        }
    }

    // Zero means unreachable. A positive status is the length of the route.
    pub fn search(
        &mut self,
        start: usize,
        goal: usize,
        step_free: bool,
        lift_penalty: f64,
        congestion: &[f32],
        waits: &[f64],
        gates: &[f64],
    ) -> usize {
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            self.seen.fill(0);
            self.epoch = 1;
        }
        self.heap.clear();
        self.route.clear();
        self.scores[start] = 0.;
        self.parent[start] = start;
        self.seen[start] = self.epoch;
        self.push(start, self.heuristic(start, goal));

        while !self.heap.is_empty() {
            let cur = self.pop();
            if cur == goal {
                let mut node = cur;
                self.route.push(node as i32);
                while node != start {
                    node = self.parent[node];
                    self.route.push(node as i32);
                }
                self.route.reverse();
                return self.route.len();
            }
            let score = self.scores[cur];
            for edge in self.start[cur] as usize..self.start[cur + 1] as usize {
                let kind = self.kind[edge];
                if step_free && (kind == self.stair || kind == self.escalator) {
                    continue;
                }
                let next = self.to[edge] as usize;
                let mut cost = f64::from(self.cost[edge]) + f64::from(congestion[next]);
                if kind == self.stair {
                    cost += self.stair_penalty;
                }
                if kind == self.lift {
                    cost += lift_penalty;
                }
                let server = self.edge_server[edge];
                if server >= 0 {
                    cost += waits[server as usize];
                }
                let mut candidate = score + cost;
                let server = self.node_server[next];
                if server >= 0 {
                    let server = server as usize;
                    let direction = self.gate_dir[edge];
                    candidate += if direction == 2 || gates.is_empty() {
                        waits[server]
                    } else {
                        gates[server * 3 + (direction + 1) as usize]
                    };
                }
                if self.seen[next] == self.epoch && self.scores[next] <= candidate {
                    continue;
                }
                self.seen[next] = self.epoch;
                self.scores[next] = candidate;
                self.parent[next] = cur;
                self.push(next, candidate + self.heuristic(next, goal));
            }
        }
        0
    }

    pub fn route(&self) -> Vec<i32> {
        self.route.clone()
    }
}

impl Router {
    fn heuristic(&self, node: usize, goal: usize) -> f64 {
        // Use the host's exact Math.hypot rounding, which can decide a heap tie.
        distance(
            f64::from(self.x[node]) - f64::from(self.x[goal]),
            f64::from(self.y[node]) - f64::from(self.y[goal]),
            f64::from(self.z[node]) - f64::from(self.z[goal]),
        ) / self.walk_speed
    }

    fn push(&mut self, node: usize, priority: f64) {
        let mut i = self.heap.len();
        self.heap.push((node, priority));
        while i > 0 {
            let parent = (i - 1) / 2;
            if self.heap[parent].1 <= self.heap[i].1 {
                break;
            }
            self.heap.swap(parent, i);
            i = parent;
        }
    }

    fn pop(&mut self) -> usize {
        let top = self.heap.swap_remove(0).0;
        let mut i = 0;
        loop {
            let left = 2 * i + 1;
            let right = left + 1;
            let mut min = i;
            if left < self.heap.len() && self.heap[left].1 < self.heap[min].1 {
                min = left;
            }
            if right < self.heap.len() && self.heap[right].1 < self.heap[min].1 {
                min = right;
            }
            if min == i {
                return top;
            }
            self.heap.swap(min, i);
            i = min;
        }
    }
}
