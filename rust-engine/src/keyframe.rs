#[inline]
pub fn clamp(val: f32, min: f32, max: f32) -> f32 {
    if val < min {
        min
    } else if val > max {
        max
    } else {
        val
    }
}

#[inline]
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

pub fn eval_cubic_bezier(t: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    if t <= 0.0 {
        return 0.0;
    }
    if t >= 1.0 {
        return 1.0;
    }

    let sample_x = |u: f32| -> f32 {
        let inv = 1.0 - u;
        3.0 * inv * inv * u * x1 + 3.0 * inv * u * u * x2 + u * u * u
    };
    let sample_dx = |u: f32| -> f32 {
        let inv = 1.0 - u;
        3.0 * inv * inv * x1 + 6.0 * inv * u * (x2 - x1) + 3.0 * u * u * (1.0 - x2)
    };
    let sample_y = |u: f32| -> f32 {
        let inv = 1.0 - u;
        3.0 * inv * inv * u * y1 + 3.0 * inv * u * u * y2 + u * u * u
    };

    let mut u = t;
    for _ in 0..6 {
        let err = sample_x(u) - t;
        let dx = sample_dx(u);
        if err.abs() < 1e-5 || dx.abs() < 1e-6 {
            break;
        }
        u = clamp(u - err / dx, 0.0, 1.0);
    }

    if (sample_x(u) - t).abs() > 1e-4 {
        let mut lo = 0.0;
        let mut hi = 1.0;
        u = t;
        for _ in 0..12 {
            let x = sample_x(u);
            if (x - t).abs() < 1e-5 {
                break;
            }
            if t > x {
                lo = u;
            } else {
                hi = u;
            }
            u = (lo + hi) * 0.5;
        }
    }

    sample_y(u)
}

pub fn apply_easing(t: f32, easing_id: i32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    let x = clamp(t, 0.0, 1.0);
    match easing_id {
        1 => x * x * x,                                               // easeIn
        2 => 1.0 - (1.0 - x) * (1.0 - x) * (1.0 - x),                // easeOut
        3 => {                                                        // easeInOut
            if x < 0.5 {
                4.0 * x * x * x
            } else {
                let p = -2.0 * x + 2.0;
                1.0 - (p * p * p) * 0.5
            }
        }
        4 => eval_cubic_bezier(x, x1, y1, x2, y2),                    // cubicBezier
        _ => x,                                                       // linear
    }
}

pub fn eval_packed_track(data: &[f32], count: usize, frame: f32, fallback: f32) -> f32 {
    if count == 0 {
        return fallback;
    }
    if count == 1 || frame <= data[0] {
        return data[1];
    }
    let last_base = (count - 1) * 7;
    if frame >= data[last_base] {
        return data[last_base + 1];
    }
    for i in 0..(count - 1) {
        let a = i * 7;
        let b = (i + 1) * 7;
        let fa = data[a];
        let fb = data[b];
        if frame >= fa && frame <= fb {
            let span = fb - fa;
            if span <= 0.0 {
                return data[b + 1];
            }
            let raw_t = (frame - fa) / span;
            let eased_t = apply_easing(
                raw_t,
                data[a + 2] as i32,
                data[a + 3],
                data[a + 4],
                data[a + 5],
                data[a + 6],
            );
            return lerp(data[a + 1], data[b + 1], eased_t);
        }
    }
    fallback
}
