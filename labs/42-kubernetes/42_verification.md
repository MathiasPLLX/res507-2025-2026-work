# Lab 42: Kubernetes verification

## Environment

```
$ k3s --version
k3s version v1.36.5+k3s1 (3dd98cc5)
go version go1.26.8
```

```
$ grep PRETTY_NAME /etc/os-release
PRETTY_NAME="Ubuntu 26.04.1 LTS"
```

```
$ kubectl get nodes -o wide
NAME             STATUS   ROLES           AGE     VERSION        INTERNAL-IP      EXTERNAL-IP   OS-IMAGE             KERNEL-VERSION                              CONTAINER-RUNTIME
asusduseigneur   Ready    control-plane   3d23h   v1.36.5+k3s1   172.27.134.180   <none>        Ubuntu 26.04.1 LTS   6.18.33.2-microsoft-standard-WSL2 (amd64)   containerd://2.3.4-k3s1.36
```

## 1. Health requests

Note: `/health` returns 503 because my app's `/health` queries PostgreSQL, which is not deployed (connection refused on port 5432). The Service path works: both requests reach the app and get its response.

Through the port-forward (`kubectl port-forward svc/quote-app 8080:80`):

```
$ curl -i --max-time 5 http://127.0.0.1:8080/health
HTTP/1.1 503 Service Unavailable
content-type: application/json; charset=utf-8
content-length: 24
Date: Mon, 19 Oct 2026 06:32:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"ok":false,"db":"down"}
```

In-cluster, through the Service name (cluster DNS):

```
$ kubectl exec service-check -- wget -S -O- http://quote-app/health
Connecting to quote-app (10.43.171.71:80)
  HTTP/1.1 503 Service Unavailable
wget: server returned error: HTTP/1.1 503 Service Unavailable
command terminated with exit code 1
```

## 2. Three Ready replicas

```
$ kubectl get deployment quote-app
NAME        READY   UP-TO-DATE   AVAILABLE   AGE
quote-app   3/3     3            3           3d21h
```

```
$ kubectl get pods -l app=quote-app -o wide
NAME                         READY   STATUS    RESTARTS   AGE    IP           NODE             NOMINATED NODE   READINESS GATES
quote-app-848f94d565-6ksgz   1/1     Running   0          11m    10.42.0.26   asusduseigneur   <none>           <none>
quote-app-848f94d565-bmfrp   1/1     Running   0          9m2s   10.42.0.28   asusduseigneur   <none>           <none>
quote-app-848f94d565-m9w9t   1/1     Running   0          20m    10.42.0.24   asusduseigneur   <none>           <none>
```

The readiness probe was a `tcpSocket` check on port 3000, because the HTTP probe on `/health` kept failing with 503 (see Limits):

```
$ grep -A5 readinessProbe deployment.yaml
          readinessProbe:
            tcpSocket:
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
```

## 3. Pod replacement

- Deleted: `quote-app-848f94d565-zgbjz`
- Replacement: `quote-app-848f94d565-bmfrp` (new name, `0/1` then `1/1` after about 7 seconds)
- The other two Pods (`6ksgz`, `m9w9t`) stayed `1/1` the whole time.

Excerpt of `kubectl get pods -l app=quote-app -w`:

```
quote-app-848f94d565-zgbjz   1/1     Terminating         0          2m35s
quote-app-848f94d565-bmfrp   0/1     Pending             0          0s
quote-app-848f94d565-bmfrp   0/1     ContainerCreating   0          0s
quote-app-848f94d565-zgbjz   0/1     Error               0          2m37s
quote-app-848f94d565-bmfrp   0/1     Running             0          2s
quote-app-848f94d565-bmfrp   1/1     Running             0          7s
```

## 4. Deliberate readiness failure

I changed only the readiness probe path to `/does-not-exist` (image, port and 3 replicas unchanged):

```
$ grep -A5 readinessProbe deployment.yaml
          readinessProbe:
            httpGet:
              path: /does-not-exist
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
```

```
$ kubectl apply -f deployment.yaml
deployment.apps/quote-app configured
```

The rollout stalls and times out, as expected, because the new Pod never becomes Ready:

```
$ kubectl rollout status deployment/quote-app --timeout=60s
Waiting for deployment "quote-app" rollout to finish: 1 out of 3 new replicas have been updated...
error: timed out waiting for the condition
```

The new Pod (`57b88c776b`) is `0/1` while the three old Pods (`848f94d565`) stay `1/1`:

```
$ kubectl get pods -l app=quote-app
NAME                         READY   STATUS    RESTARTS   AGE
quote-app-57b88c776b-sfqf4   0/1     Running   0          77s
quote-app-848f94d565-6ksgz   1/1     Running   0          18m
quote-app-848f94d565-bmfrp   1/1     Running   0          15m
quote-app-848f94d565-m9w9t   1/1     Running   0          27m
```

```
$ kubectl get rs -l app=quote-app
NAME                   DESIRED   CURRENT   READY   AGE
quote-app-57b88c776b   1         1         0       85s
quote-app-69fbbcff49   0         0         0       3d21h
quote-app-848f94d565   3         3         3       27m
```

The probe failure event, with HTTP status 404 (last line; the older lines are earlier events):

```
$ kubectl get events --field-selector reason=Unhealthy --sort-by=.metadata.creationTimestamp
LAST SEEN   TYPE      REASON      OBJECT                           MESSAGE
3d21h       Warning   Unhealthy   pod/quote-app-69fbbcff49-vjkk2   Readiness probe failed: HTTP probe failed with statuscode: 503
29m         Warning   Unhealthy   pod/quote-app-69fbbcff49-vjkk2   Readiness probe failed: HTTP probe failed with statuscode: 503
15m         Warning   Unhealthy   pod/quote-app-848f94d565-zgbjz   Readiness probe failed: dial tcp 10.42.0.27:3000: connect: connection refused
3s          Warning   Unhealthy   pod/quote-app-57b88c776b-sfqf4   Readiness probe failed: HTTP probe failed with statuscode: 404
```

Excerpt of `kubectl describe pod quote-app-57b88c776b-sfqf4`: the container is `Running` but not Ready, it has not restarted, and the probe targets the bad path:

```
Status:           Running
Controlled By:    ReplicaSet/quote-app-57b88c776b
    State:          Running
    Ready:          False
    Restart Count:  0
    Readiness:      http-get http://:3000/does-not-exist delay=3s timeout=1s period=5s #success=1 #failure=3
Conditions:
  Type                        Status
  Ready                       False
  ContainersReady             False
Events:
  Warning  Unhealthy  61s (x25 over 2m56s)  kubelet  Readiness probe failed: HTTP probe failed with statuscode: 404
```

Excerpt of the application logs (the app answers each probe request with 404 because the route does not exist; the same entry repeats every 5 seconds):

```
$ kubectl logs quote-app-57b88c776b-sfqf4
[06:37:58.501] INFO (19): Server listening at http://127.0.0.1:3000
[06:37:58.503] INFO (19): Server listening at http://10.42.0.29:3000
[06:38:03.204] INFO (19): incoming request
    req: { "method": "GET", "url": "/does-not-exist", ... }
[06:38:03.205] INFO (19): Route GET:/does-not-exist not found
[06:38:03.213] INFO (19): request completed
    res: { "statusCode": 404 }
```

The Service endpoints: the new Pod is not ready, so it is not eligible for normal Service traffic, while the three old Pods still are:

```
$ kubectl get endpointslices -l kubernetes.io/service-name=quote-app -o jsonpath={range .items[*].endpoints[*]}{.targetRef.name}{"\t"}{.conditions.ready}{"\n"}{end}
quote-app-848f94d565-m9w9t	true
quote-app-848f94d565-6ksgz	true
quote-app-848f94d565-bmfrp	true
quote-app-57b88c776b-sfqf4	false
```

## 5. Recovery

I restored the working `tcpSocket` readiness probe and re-applied the file (the path `/does-not-exist` is gone):

```
$ grep -A5 readinessProbe deployment.yaml
          readinessProbe:
            tcpSocket:
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
```

```
$ kubectl apply -f deployment.yaml
deployment.apps/quote-app configured
```

```
$ kubectl rollout status deployment/quote-app --timeout=120s
deployment "quote-app" successfully rolled out
```

Three Pods are Ready again. They are the same three Pods as before the failure (ages 22m, 19m and 31m), because they never stopped running:

```
$ kubectl get pods -l app=quote-app
NAME                         READY   STATUS    RESTARTS   AGE
quote-app-848f94d565-6ksgz   1/1     Running   0          22m
quote-app-848f94d565-bmfrp   1/1     Running   0          19m
quote-app-848f94d565-m9w9t   1/1     Running   0          31m
```

The Deployment went back to the original ReplicaSet (`848f94d565`, 3 desired and 3 ready) and the failed one (`57b88c776b`) was scaled down to 0:

```
$ kubectl get rs -l app=quote-app
NAME                   DESIRED   CURRENT   READY   AGE
quote-app-57b88c776b   0         0         0       5m22s
quote-app-69fbbcff49   0         0         0       3d21h
quote-app-848f94d565   3         3         3       31m
```

All Service endpoints are ready again and the failing Pod has been removed:

```
$ kubectl get endpointslices -l kubernetes.io/service-name=quote-app -o jsonpath={range .items[*].endpoints[*]}{.targetRef.name}{"\t"}{.conditions.ready}{"\n"}{end}
quote-app-848f94d565-m9w9t	true
quote-app-848f94d565-6ksgz	true
quote-app-848f94d565-bmfrp	true
```

## 6. Symptom / Cause / Fix

- **Symptom:** After changing the readiness probe path to `/does-not-exist`, the rollout timed out and the new Pod stayed `0/1` (container `Running`, Pod not Ready, 0 restarts). The three old Pods stayed `1/1`, and the new Pod's endpoint showed `ready: false`.
- **Cause:** The probe requested `/does-not-exist`, a route the app does not have, so every check returned HTTP 404. The `Unhealthy` event said `Readiness probe failed: HTTP probe failed with statuscode: 404`, and the app logs showed the same 404 for each request. The container itself was fine, which is why status and logs alone did not name the cause; the event did.
- **Fix:** I changed the probe back in `deployment.yaml` (the path `/does-not-exist` removed, working probe restored) and re-applied it. The rollout completed and three Pods were Ready again. Readiness recovered because the probe was again checking something the app answers, so Kubernetes marked the Pods Ready and kept them in the Service endpoints. I fixed the probe rather than removing it.
- **Why no restart:** A failing readiness probe only removes a Pod from Service traffic; it does not restart the container (that is what a liveness probe does). The old Pods kept serving during the stalled rolling update.

## 7. Limits of this validation

- `/health` returns 503 (`{"ok":false,"db":"down"}`) because my app queries PostgreSQL and no database is deployed. The lab's baseline expects `{"ok": true}` without a database check.
- To get Pods Ready, I used a `tcpSocket` readiness probe on port 3000 (and a `tcpSocket` liveness probe for Lane B). They only prove the app accepts connections, not that the app is healthy.
- Quote retrieval and insertion are untested; they need the database (Lab 52 / Lane D).
- Three replicas on a single node do not protect against losing the VM.

## Extension: Lane B (liveness probes)

I used a `tcpSocket` liveness probe on port 3000 rather than the lab's HTTP probe on `/health`, because `/health` returns 503 without the database and would have made the Pods restart from the start. This kept a clean baseline, so the only thing that changed in the failure step was the liveness port.

### Baseline: healthy liveness probe

```
$ grep -B1 -A5 -E readinessProbe|livenessProbe deployment.yaml
            - containerPort: 3000
          livenessProbe:
            tcpSocket:
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
```

```
$ kubectl apply -f deployment.yaml
deployment.apps/quote-app configured
```

```
$ kubectl rollout status deployment/quote-app --timeout=120s
deployment "quote-app" successfully rolled out
```

All Pods Ready with 0 restarts:

```
$ kubectl get pods -l app=quote-app
NAME                         READY   STATUS    RESTARTS   AGE
quote-app-57cf676b9c-5h8k5   1/1     Running   0          73s
quote-app-57cf676b9c-pklnh   1/1     Running   0          72s
quote-app-57cf676b9c-wz754   1/1     Running   0          70s
```

### Deliberate liveness failure

I changed only the liveness probe port from 3000 to 3999 (nothing listens there):

```
$ grep -B1 -A5 -E readinessProbe|livenessProbe deployment.yaml
            - containerPort: 3000
          livenessProbe:
            tcpSocket:
              port: 3999
            initialDelaySeconds: 3
            periodSeconds: 5
```

```
$ kubectl apply -f deployment.yaml
deployment.apps/quote-app configured
```

After about two minutes the containers had been restarted several times and went into `CrashLoopBackOff`:

```
$ kubectl get pods -l app=quote-app
NAME                        READY   STATUS             RESTARTS      AGE
quote-app-5f5d86f68-7v5lc   0/1     CrashLoopBackOff   5 (14s ago)   2m10s
quote-app-5f5d86f68-zpqx8   0/1     CrashLoopBackOff   4 (32s ago)   2m8s
quote-app-5f5d86f68-zqx2n   0/1     CrashLoopBackOff   5 (11s ago)   2m7s
```

Excerpt of `kubectl describe pod quote-app-5f5d86f68-7v5lc`: the restart count increased, the container was terminated, and the probe points at the wrong port:

```
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1
    Restart Count:  5
    Liveness:       tcp-socket :3999 delay=3s timeout=1s period=5s #success=1 #failure=3
Events:
  Warning  Unhealthy  37s (x18 over 2m27s)  kubelet  Liveness probe failed: dial tcp 10.42.0.33:3999: connect: connection refused
  Normal   Killing    37s (x6 over 2m17s)   kubelet  Container quote-app failed liveness probe, will be restarted
  Warning  BackOff    36s (x4 over 91s)     kubelet  Back-off restarting failed container quote-app in pod quote-app-5f5d86f68-7v5lc_quote-lab(...)
```

The liveness failure events for the three new Pods (the last three lines):

```
$ kubectl get events --sort-by=.metadata.creationTimestamp --field-selector reason=Unhealthy
LAST SEEN   TYPE      REASON      OBJECT                           MESSAGE
...
44s         Warning   Unhealthy   pod/quote-app-5f5d86f68-7v5lc    Liveness probe failed: dial tcp 10.42.0.33:3999: connect: connection refused
3s          Warning   Unhealthy   pod/quote-app-5f5d86f68-zpqx8    Liveness probe failed: dial tcp 10.42.0.34:3999: connect: connection refused
42s         Warning   Unhealthy   pod/quote-app-5f5d86f68-zqx2n    Liveness probe failed: dial tcp 10.42.0.35:3999: connect: connection refused
```

```
$ kubectl get events --sort-by=.metadata.creationTimestamp --field-selector reason=Killing
LAST SEEN   TYPE     REASON    OBJECT                           MESSAGE
...
48s         Normal   Killing   pod/quote-app-5f5d86f68-7v5lc    Container quote-app failed liveness probe, will be restarted
7s          Normal   Killing   pod/quote-app-5f5d86f68-zpqx8    Container quote-app failed liveness probe, will be restarted
46s         Normal   Killing   pod/quote-app-5f5d86f68-zqx2n    Container quote-app failed liveness probe, will be restarted
```

While the probe was still broken, the rollout never settled; the number of available Pods kept dropping back to 0 as containers were killed:

```
$ kubectl rollout status deployment/quote-app --timeout=120s
Waiting for deployment "quote-app" rollout to finish: 0 of 3 updated replicas are available...
Waiting for deployment "quote-app" rollout to finish: 1 of 3 updated replicas are available...
Waiting for deployment "quote-app" rollout to finish: 2 of 3 updated replicas are available...
Waiting for deployment "quote-app" rollout to finish: 1 of 3 updated replicas are available...
Waiting for deployment "quote-app" rollout to finish: 0 of 3 updated replicas are available...
```

### Restore

```
$ grep -B1 -A5 -E readinessProbe|livenessProbe deployment.yaml
            - containerPort: 3000
          livenessProbe:
            tcpSocket:
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
```

```
$ kubectl apply -f deployment.yaml
deployment.apps/quote-app configured
```

```
$ kubectl rollout status deployment/quote-app --timeout=120s
deployment "quote-app" successfully rolled out
```

Three new Pods are Ready with 0 restarts:

```
$ kubectl get pods -l app=quote-app
NAME                         READY   STATUS    RESTARTS   AGE
quote-app-57cf676b9c-gzgpc   1/1     Running   0          25s
quote-app-57cf676b9c-rn5wz   1/1     Running   0          23s
quote-app-57cf676b9c-zn6lv   1/1     Running   0          24s
```

### What this demonstrates

- A failing **liveness** probe makes Kubernetes kill and restart the container: the restart count rose to 4 and 5, the events said `failed liveness probe, will be restarted`, and the Pods ended in `CrashLoopBackOff`.
- In section 4, a failing **readiness** probe did not restart anything (0 restarts): it only kept the Pod out of the Service endpoints. Readiness controls traffic; liveness controls restarts.
- Restoring the probe port to 3000 brought the Pods back to `1/1` with 0 restarts.

### Correction and final state

While doing the Lane B tests above, my `deployment.yaml` had lost its `readinessProbe` block (only `livenessProbe` was present, which is why the captures above show a single probe). I noticed this afterwards, restored the readiness probe, and re-applied. The Lane B result does not depend on it: the restarts come from the liveness probe alone. This is the final configuration, with both probes:

```
$ grep -B1 -A10 -E readinessProbe|livenessProbe deployment.yaml
            - containerPort: 3000
          readinessProbe:
            tcpSocket:
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
          livenessProbe:
            tcpSocket:
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
```

```
$ kubectl apply -f deployment.yaml
deployment.apps/quote-app configured
```

```
$ kubectl rollout status deployment/quote-app --timeout=120s
...
deployment "quote-app" successfully rolled out
```

```
$ kubectl get pods -l app=quote-app
NAME                        READY   STATUS    RESTARTS   AGE
quote-app-cbd987cb7-chsvc   1/1     Running   0          25s
quote-app-cbd987cb7-xz9h2   1/1     Running   0          13s
quote-app-cbd987cb7-zccm7   1/1     Running   0          19s
```

The cluster confirms both probes on the final Deployment (3 desired, 3 updated, 3 available):

```
$ kubectl describe deployment quote-app
Replicas:               3 desired | 3 updated | 3 total | 3 available | 0 unavailable
...
    Image:         quote-app:local
    Port:          3000/TCP
    Liveness:      tcp-socket :3000 delay=3s timeout=1s period=5s #success=1 #failure=3
    Readiness:     tcp-socket :3000 delay=3s timeout=1s period=5s #success=1 #failure=3
...
NewReplicaSet:   quote-app-cbd987cb7 (3/3 replicas created)
```
