"""Build atlas.json from the original ICA-Lens v3 experiment. Python 3, numpy, scipy.

The shared chart fits unit residuals and normalized ICA writing columns in the
same residual coordinate system. A spherical development then preserves the
arcs and tangent turns of each trajectory. Mirror choices minimize deviation
from the shared chart and recent high-dimensional pair distances. Long-range
distances and the apparent proximity of a token to an island are approximate.
"""
import argparse
from collections import defaultdict
import json
import os
from pathlib import Path
import struct

os.environ["OPENBLAS_NUM_THREADS"] = "2"
import numpy as np
from scipy.linalg import eigh
from scipy.optimize import minimize

WORK = Path.home() / "work"
LIGHT = WORK / "memory-of-my-gemini/doc/grocery-haven/icalens-v3-exp2-cot-navigation-20261117"
V3 = WORK / "ica-lens-qwen38-27b-v3"
FIELDS = dict(s="s_geo", g="kappa_geo", rank5="erank_dir", z="zmax_positive",
              theta="theta_surf", delta="deltaC_10", kurt="kurt_d", top20="top20_energy")


def read(path):
    return json.loads(path.read_bytes())


def unit(a):
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-12)


def angle(cosine):
    return np.arccos(np.clip(cosine, -1, 1))


def number(x, precision=6):
    return round(float(x), precision) if np.isfinite(x) else None


def matrix(path, field):
    with path.open("rb") as stream:
        header_length = struct.unpack("<Q", stream.read(8))[0]
        metadata = json.loads(stream.read(header_length))[field]
    assert metadata["dtype"] == "F32"
    return np.memmap(path, dtype="<f4", mode="r", shape=tuple(metadata["shape"]),
                     offset=8 + header_length + metadata["data_offsets"][0])


def sphere_chart(vectors):
    """Sparse spherical MDS on measured strongest/weakest cosine neighborhoods."""
    gram = np.clip(vectors @ vectors.T, -1, 1)
    n = len(gram)
    eig, basis = eigh(gram, subset_by_index=[n-3, n-1])
    principal = unit((basis * np.sqrt(eig)).astype(np.float64))
    # Resolve arbitrary eigenvector signs reproducibly with their largest loadings.
    principal *= np.sign(principal[np.abs(principal).argmax(axis=0), np.arange(3)])
    order = np.argsort(gram, axis=1, kind="stable")
    neighbor = np.concatenate((order[:, -12:-1], order[:, :4]), axis=1)
    ii = np.repeat(np.arange(n), neighbor.shape[1])
    jj = neighbor.ravel()
    measured = angle(gram[ii, jj])
    def stress(x):
        raw = x.reshape(n, 3)
        points = unit(raw)
        cos = np.sum(points[ii] * points[jj], axis=1).clip(-0.99999999, 0.99999999)
        error = angle(cos) - measured
        weight = -2 * error / np.sqrt(1 - cos*cos)
        grad = 2 * (points - principal)
        for k in range(3):
            grad[:, k] += np.bincount(ii, weights=weight * points[jj, k], minlength=n)
            grad[:, k] += np.bincount(jj, weights=weight * points[ii, k], minlength=n)
        loss = error @ error + np.square(points-principal).sum()
        tangent = grad - points * np.sum(points*grad, axis=1, keepdims=True)
        return loss, (tangent / np.linalg.norm(raw, axis=1, keepdims=True)).ravel()
    result = minimize(stress, principal.ravel(), jac=True, method="L-BFGS-B",
                      options=dict(maxiter=180, ftol=1e-9))
    points = unit(result.x.reshape(n, 3))
    rmse = np.sqrt(np.mean((angle((points[ii]*points[jj]).sum(1))-measured)**2))
    return points, np.degrees(rmse)


def develop(vectors, target):
    """Exact spherical steps and unsigned turns; select the better of two mirrors."""
    x = unit(vectors.astype(float))
    result = [target[0]]
    for i in range(1, len(x)):
        p = result[-1]
        arc = angle(x[i-1] @ x[i])
        if i == 1:
            course = unit(target[i] - p * (target[i] @ p))
        else:
            incoming = unit(x[i-1]*(x[i-2] @ x[i-1]) - x[i-2])
            outgoing = unit(x[i]-x[i-1]*(x[i] @ x[i-1]))
            turn = angle(incoming @ outgoing)
            forward = unit(p*(result[-2] @ p) - result[-2])
            side = np.cross(p, forward)
            headings = forward*np.cos(turn) + np.array([[1], [-1]])*side*np.sin(turn)
            possibilities = np.cos(arc)*p + np.sin(arc)*headings
            history = np.asarray(result[-12:])
            old_angles = angle(x[max(i-12, 0):i] @ x[i])
            errors = angle(possibilities @ history.T) - old_angles
            cost = angle(possibilities @ target[i])**2 + 2*np.mean(errors**2, axis=1)
            course = headings[np.argmin(cost)]
        result.append(unit(p*np.cos(arc) + course*np.sin(arc)))
    return np.asarray(result)


def extract(light, model, output):
    heavy = model / "experiments/exp2_cot_navigation"
    # Include the incoming point for the published correction event at t=146.
    selections = {
        "rail_01": ("rail_01", None), "rail_02": ("rail_02", None),
        "reason_01": ("reason_01", "scope"), "reason_08": ("reason_08", "scope"),
        "dive": ("rail_01", "depth"), "correction_mul49": ("correction_mul49", range(144,151)),
        "reason_05": ("reason_05", range(123,132)), "forced": ("port_eos_direct_forced", None),
        "natural": ("port_eos_probe_0", None), "repeat": ("cycle_positive_control", None)}
    scopes = read(light/"scope.json")
    tracks, keys, raw, indices = {}, {}, [], {}
    all_z, needed = {}, defaultdict(set)
    for name, (case, select) in selections.items():
        trace = read(light / "traces" / f"{case}.json")
        scope = scopes[case]
        times = range(trace["prompt_length"], trace["total_tokens"])
        if select == "scope":
            times = range(scope["start"], scope["end"])
        elif isinstance(select, range):
            times = select
        locations = [(32, t) for t in times]
        if select == "depth":
            section = next(x for x in read(light/"vertical_sections.json")
                           if x["case"] == case and x["token"] == 18)
            locations = [(f["layer"], f["t"]) for f in section["layers"]]
        arr = np.load(heavy / case / "residual_bf16.npy", mmap_mode="r")
        all_z[case] = np.load(heavy / case / "ica_z.npy", mmap_mode="r")
        with np.load(heavy/case/"metrics.npz") as file:
            metrics = {k:file[k] for k in [*FIELDS.values(),"H_bits","top5_axis","top5_z"]}
        frames, indices[name] = [], []
        for layer,t in locations:
            # Deduplicate actual identical vectors, including the EOS pair prefix and L32 depth frame.
            sample = arr[layer,t]
            unique = sample.tobytes()
            if unique not in keys:
                keys[unique] = len(raw)
                raw.append(unit((sample.astype(np.uint32)<<16).view(np.float32)))
            indices[name].append(keys[unique])
            frame = dict(t=t, token=trace["token_text"][t], layer=layer, H=number(metrics["H_bits"][t]))
            for key,field in FIELDS.items():
                frame[key] = number(metrics[field][layer,t])
            frame["top"] = []
            for axis, z in zip(metrics["top5_axis"][layer,t], metrics["top5_z"][layer,t]):
                axis = int(axis)
                needed[layer].add(axis)
                frame["top"].append(dict(id=f"L{layer:02} C{axis}",z=number(z)))
            frames.append(frame)
        tracks[name] = dict(case=case,frames=frames,text=trace["generated_text"],
                            prompt=trace["prompt"],scope=scope)
    islands = {}
    island_indices = {}
    for layer,axes in sorted(needed.items()):
        # Export measured atlas axes only: the union of top-five positive islands.
        labels = read(light / "island_labels" / f"L{layer:02}.json")
        stats = read(model / f"L{layer:02}/statistics.json")["test"]["excess_kurtosis"]
        directions = matrix(model / f"hf_clean_upload/artifacts/resid_post/layer_{layer:02}.safetensors",
                            "writing_matrix")
        for axis in sorted(axes):
            key = f"L{layer:02} C{axis}"
            island_indices[key] = len(raw)
            raw.append(unit(directions[:,axis]))
            islands[key] = dict(id=key,layer=layer,axis=axis,k=number(stats[axis]),
                                words=[x["text"] for x in labels[str(axis)]["positive"]])
    vectors = np.stack(raw)
    projected, fitted_error = sphere_chart(vectors)
    for key, island in islands.items():
        island["p"] = projected[island_indices[key]].round(7).tolist()
    maxima = dict(step=0., turn=0.)
    for name, track in tracks.items():
        ix = indices[name]
        pts = develop(vectors[ix], projected[ix])
        if name == "dive":
            # Anchor the depth survey to the exact position already assigned to the same L32 residual.
            at = [f for f in tracks["rail_01"]["frames"] if f["t"] == 18][0]["p"]
            a, b = pts[32], unit(np.asarray(at))
            v = np.cross(a,b)
            skew = np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
            rotation = np.eye(3) + skew + skew@skew / (1+a@b)
            pts = pts @ rotation.T
        for i,(frame, p) in enumerate(zip(track["frames"],pts)):
            layer, t = frame["layer"],frame["t"]
            frame["p"] = p.round(7).tolist()
            axes = sorted(needed[layer])
            scores = all_z[track["case"]][layer,t,axes]
            frame["scores"] = {f"L{layer:02} C{a}":number(z,3) for a,z in zip(axes,scores)}
            if name != "dive" and i:
                err = abs(angle(pts[i-1] @ p) - frame["s"])
                maxima["step"] = max(err,maxima["step"])
                if i >= 2:
                    mid, prev = pts[i-1],pts[i-2]
                    turn = angle(unit(mid*(prev@mid)-prev) @ unit(p-mid*(p@mid)))
                    maxima["turn"] = max(abs(turn-frame["theta"]),maxima["turn"])
    assert max(maxima.values()) < 0.0001, maxima
    assert np.allclose([f["p"] for f in tracks["natural"]["frames"]],
                       [f["p"] for f in tracks["forced"]["frames"][:3]], atol=1e-5)
    # Cross-check the extraction against independently saved public event windows.
    for name, filename in [("correction_mul49", "correction_mul49_149"), ("reason_05","reason_05_127")]:
        by_time = {f["t"]: f for f in tracks[name]["frames"]}
        for event in read(light/"events"/f"{filename}.json"):
            if event["t"] not in by_time:
                continue
            frame = by_time[event["t"]]
            assert frame["token"] == event["token"]
            assert abs(frame["z"] - event["zmax"]) < 1e-5
            assert frame["top"][0]["id"] == f"L32 C{event['islands'][0]['axis']}"
    port_metrics = {p["id"]:p for p in read(light/"port_metrics.json")}
    for name in ["repeat","forced","natural"]:
        track = tracks[name]
        port = port_metrics[track["case"]]
        track["port"] = {k:port[k] for k in ["arm","before","after","first_eos"]}
    cal = read(light/"calibration.json")
    groups = {k:v["32"] for k,v in read(light/"summary.json")["groups"].items()}
    dataset = dict(tracks=tracks,islands=islands,groups=groups,
                   calibration={**cal["layers"][32],**{k:cal[k] for k in
                     ["zmax","top20_energy","coordinate_kurtosis","n_gaussian","dimension","seed"]}},
                   eos=read(light/"real_eos_final_metrics.json"),
                   ablation=read(light/"mask_permutation_ablation.json"),
                   projection=dict(method="spherical neighborhood MDS + geodesic development",
                                   dimension=5120,neighborsAngularRMSEdeg=number(fitted_error),
                                   maxStepErrorRad=number(maxima["step"],8),
                                   maxTurnErrorRad=number(maxima["turn"],8)))
    output.write_text(json.dumps(dataset,ensure_ascii=False,separators=(",",":"),allow_nan=False))
    print(output, output.stat().st_size, "bytes;", len(islands), "axes;", dataset["projection"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--light",type=Path,default=LIGHT)
    parser.add_argument("--model",type=Path,default=V3)
    parser.add_argument("--output",type=Path,default=Path(__file__).with_name("atlas.json"))
    args = parser.parse_args()
    extract(args.light,args.model,args.output)
